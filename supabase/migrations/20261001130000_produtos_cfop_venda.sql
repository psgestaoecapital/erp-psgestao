-- CFOP na edição fiscal em massa e na emissão (CEO 30/09). Até aqui o produto sem CFOP de venda saía com "5102
-- automático" e, fora do estado, o CFOP era derivado trocando o 5 por 6 (5405 virava 6405, que não existe — o certo é 6404).
-- Agora: CFOP de venda DENTRO do estado (erp_produtos.cfop_venda) e FORA do estado (erp_produtos.cfop_venda_interestadual,
-- coluna nova) vêm do cadastro. CEO 01/10: esta é a PARTE A (sem trava) — só cadastro e edição em massa; a trava na
-- emissão (produto sem o CFOP do escopo da nota não emite) entra depois, em PR própria, com FCR e KGF já preenchidas.
--  1) coluna cfop_venda_interestadual;
--  2) erp_produto_fiscal_alteracao.campo aceita cfop_venda e cfop_venda_interestadual;
--  3) fn_produtos_fiscal_massa: os 2 CFOPs como campos (5xxx dentro, 6xxx fora), filtro "CSOSN/CST do ICMS igual a"
--     (ex.: 500 → 5405/6404) e "sem o CFOP"; "algum" passa a incluir o CFOP de venda dentro do estado;
--  4) fn_fiscal_previo: sem_tributacao passa a contar o produto sem CFOP de venda dentro do estado;
--  5) manual da BPO (bpo.fiscal.tributacao_produtos): passo do CFOP.
-- Fonte (RD-72): Anexo do Convênio s/nº de 15/12/1970 — CFOP 5.102/6.102 (venda de mercadoria adquirida de terceiros),
-- 5.405/6.404 (mercadoria com ICMS já retido por substituição tributária).
-- A migration NÃO altera produto nenhum. SECURITY DEFINER → REVOKE anon + GRANT (gate).

ALTER TABLE public.erp_produtos ADD COLUMN IF NOT EXISTS cfop_venda_interestadual text;
COMMENT ON COLUMN public.erp_produtos.cfop_venda_interestadual IS 'CFOP de venda para destinatário de outra UF (6xxx). Sem ele, venda interestadual não emite.';

DO $chk$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.erp_produto_fiscal_alteracao'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%campo%'
  LOOP
    EXECUTE format('ALTER TABLE public.erp_produto_fiscal_alteracao DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $chk$;
ALTER TABLE public.erp_produto_fiscal_alteracao ADD CONSTRAINT erp_produto_fiscal_alteracao_campo_check
  CHECK (campo IN ('tipo_item_sped','cst_icms','cst_pis','cst_cofins','cfop_venda','cfop_venda_interestadual'));

-- 3) edição em massa
CREATE OR REPLACE FUNCTION public.fn_produtos_fiscal_massa(
  p_company_id uuid, p_filtro jsonb, p_valores jsonb, p_sobrescrever boolean DEFAULT false, p_aplicar boolean DEFAULT false,
  p_observacao text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_simples boolean;
  v_regime text;
  -- tabelas oficiais (iguais a src/lib/produtos/fiscalMassa.ts)
  c_tipo text[] := ARRAY['00','01','02','03','04','05','06','07','08','09','10','99'];
  c_csosn text[] := ARRAY['101','102','103','201','202','203','300','400','500','900'];
  c_cst_icms text[] := ARRAY['00','02','10','15','20','30','40','41','50','51','53','60','61','70','90'];
  c_cst_pc text[] := ARRAY['01','02','03','04','05','06','07','08','09','49','50','51','52','53','54','55','56',
                           '60','61','62','63','64','65','66','67','70','71','72','73','74','75','98','99'];
  v_tipo text := NULLIF(btrim(COALESCE(p_valores->>'tipo_item_sped','')),'');
  v_icms text := NULLIF(btrim(COALESCE(p_valores->>'cst_icms','')),'');
  v_pis text := NULLIF(btrim(COALESCE(p_valores->>'cst_pis','')),'');
  v_cofins text := NULLIF(btrim(COALESCE(p_valores->>'cst_cofins','')),'');
  v_cfop text := NULLIF(btrim(COALESCE(p_valores->>'cfop_venda','')),'');
  v_cfop_fora text := NULLIF(btrim(COALESCE(p_valores->>'cfop_venda_interestadual','')),'');
  v_icms_igual text := NULLIF(btrim(COALESCE(p_filtro->>'icms_igual','')),'');
  v_ncm text := NULLIF(regexp_replace(COALESCE(p_filtro->>'ncm',''),'\D','','g'),'');
  -- vários prefixos: "3208, 3209 3210;3214" → {3208,3209,3210,3214}
  v_prefixos text[] := (SELECT array_agg(x) FROM regexp_split_to_table(COALESCE(p_filtro->>'ncm_prefixo',''), '[^0-9]+') x WHERE x <> '');
  v_obs text := NULLIF(btrim(COALESCE(p_observacao,'')),'');
  v_grupo text := NULLIF(btrim(COALESCE(p_filtro->>'grupo','')),'');
  v_sem text := NULLIF(btrim(COALESCE(p_filtro->>'sem_campo','')),'');
  v_todos boolean := COALESCE((p_filtro->>'todos')::boolean, false);
  v_servicos boolean := COALESCE((p_filtro->>'incluir_servicos')::boolean, false);
  v_inativos boolean := COALESCE((p_filtro->>'incluir_inativos')::boolean, false);
  v_sobre boolean := COALESCE(p_sobrescrever, false);
  v_alvo int; v_prod_mudam int; v_campos int; v_por_campo jsonb; v_amostra jsonb;
  v_lote uuid; v_email text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'login obrigatório' USING errcode = '42501'; END IF;
  IF NOT (EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = v_uid AND uc.company_id = p_company_id)
          OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_uid AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM'))) THEN
    RAISE EXCEPTION 'sem acesso a esta empresa' USING errcode = '42501';
  END IF;

  SELECT regime_tributario INTO v_regime FROM public.companies WHERE id = p_company_id;
  IF COALESCE(btrim(v_regime),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'regime_indefinido',
      'mensagem', 'A empresa está sem regime tributário. Defina o regime (Simples ou normal) antes: ele decide se o ICMS é CSOSN ou CST.');
  END IF;
  -- mesmo teste do nfe-builder (ehSimples = regime contém 'simples')
  v_simples := lower(v_regime) LIKE '%simples%';

  -- ── validação: pelo menos um valor e um critério; cada código na tabela oficial e no regime ─────────────
  IF v_tipo IS NULL AND v_icms IS NULL AND v_pis IS NULL AND v_cofins IS NULL AND v_cfop IS NULL AND v_cfop_fora IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_valor', 'mensagem', 'Escolha o valor de pelo menos um dos campos.');
  END IF;
  IF v_ncm IS NULL AND v_prefixos IS NULL AND v_grupo IS NULL AND v_sem IS NULL AND v_icms_igual IS NULL AND NOT v_todos THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_filtro',
      'mensagem', 'Escolha um filtro (NCM, prefixo de NCM, grupo ou "sem o campo") ou marque "todos os produtos".');
  END IF;
  IF v_sem IS NOT NULL AND v_sem NOT IN ('tipo_item_sped','cst_icms','cst_pis','cst_cofins','cfop_venda','cfop_venda_interestadual','algum') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'filtro_invalido', 'mensagem', 'Filtro "sem o campo" inválido: ' || v_sem);
  END IF;
  IF v_tipo IS NOT NULL AND NOT v_tipo = ANY(c_tipo) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido', 'campo', 'tipo_item_sped',
      'mensagem', v_tipo || ' não é um Tipo do item (SPED) válido (00 a 10 ou 99).');
  END IF;
  IF v_icms IS NOT NULL AND v_simples AND NOT v_icms = ANY(c_csosn) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido', 'campo', 'cst_icms',
      'mensagem', v_icms || ' não é CSOSN. Empresa do Simples usa CSOSN (3 dígitos, ex.: 102, 500).');
  END IF;
  IF v_icms IS NOT NULL AND NOT v_simples AND NOT v_icms = ANY(c_cst_icms) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido', 'campo', 'cst_icms',
      'mensagem', v_icms || ' não é CST do ICMS. Empresa do regime normal usa CST (2 dígitos, ex.: 00, 60).');
  END IF;
  IF v_pis IS NOT NULL AND NOT v_pis = ANY(c_cst_pc) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido', 'campo', 'cst_pis', 'mensagem', v_pis || ' não é um CST do PIS válido.');
  END IF;
  IF v_cfop IS NOT NULL AND v_cfop !~ '^5\d{3}$' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido', 'campo', 'cfop_venda',
      'mensagem', v_cfop || ' não é CFOP de venda dentro do estado (4 dígitos começando com 5, ex.: 5102, 5405).');
  END IF;
  IF v_cfop_fora IS NOT NULL AND v_cfop_fora !~ '^6\d{3}$' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido', 'campo', 'cfop_venda_interestadual',
      'mensagem', v_cfop_fora || ' não é CFOP de venda fora do estado (4 dígitos começando com 6, ex.: 6102, 6404).');
  END IF;
  IF v_cofins IS NOT NULL AND NOT v_cofins = ANY(c_cst_pc) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido', 'campo', 'cst_cofins', 'mensagem', v_cofins || ' não é um CST da COFINS válido.');
  END IF;

  -- ── alvo + mudanças (uma linha por produto × campo que muda) ───────────────────────────────────────────
  CREATE TEMP TABLE IF NOT EXISTS _pfm_mudanca (produto_id uuid, codigo text, nome text, ncm text, campo text, antes text, depois text) ON COMMIT DROP;
  TRUNCATE _pfm_mudanca;

  WITH alvo AS (
    SELECT p.id, p.codigo, p.nome, p.ncm, p.tipo_item_sped, p.cst_icms, p.cst_pis, p.cst_cofins, p.cfop_venda, p.cfop_venda_interestadual
    FROM public.erp_produtos p
    WHERE p.company_id = p_company_id
      AND (v_inativos OR COALESCE(p.ativo, true))
      AND (v_servicos OR lower(COALESCE(p.tipo,'')) NOT LIKE '%servi%')
      AND (v_ncm IS NULL OR regexp_replace(COALESCE(p.ncm,''),'\D','','g') = v_ncm)
      AND (v_prefixos IS NULL OR EXISTS (SELECT 1 FROM unnest(v_prefixos) px WHERE regexp_replace(COALESCE(p.ncm,''),'\D','','g') LIKE px || '%'))
      AND (v_grupo IS NULL OR p.grupo = v_grupo)
      AND (v_icms_igual IS NULL OR btrim(COALESCE(p.cst_icms,'')) = v_icms_igual)
      AND (v_sem IS NULL
        OR (v_sem = 'tipo_item_sped' AND COALESCE(btrim(p.tipo_item_sped),'') = '')
        OR (v_sem = 'cst_icms' AND COALESCE(btrim(p.cst_icms),'') = '')
        OR (v_sem = 'cst_pis' AND COALESCE(btrim(p.cst_pis),'') = '')
        OR (v_sem = 'cst_cofins' AND COALESCE(btrim(p.cst_cofins),'') = '')
        OR (v_sem = 'cfop_venda' AND COALESCE(btrim(p.cfop_venda),'') = '')
        OR (v_sem = 'cfop_venda_interestadual' AND COALESCE(btrim(p.cfop_venda_interestadual),'') = '')
        OR (v_sem = 'algum' AND (COALESCE(btrim(p.tipo_item_sped),'') = '' OR COALESCE(btrim(p.cst_icms),'') = ''
                                 OR COALESCE(btrim(p.cst_pis),'') = '' OR COALESCE(btrim(p.cst_cofins),'') = ''
                                 OR COALESCE(btrim(p.cfop_venda),'') = '')))
  )
  INSERT INTO _pfm_mudanca
  SELECT a.id, a.codigo, a.nome, a.ncm, c.campo, NULLIF(btrim(c.antes),''), c.depois
  FROM alvo a
  CROSS JOIN LATERAL (VALUES ('tipo_item_sped', a.tipo_item_sped, v_tipo), ('cst_icms', a.cst_icms, v_icms),
                             ('cst_pis', a.cst_pis, v_pis), ('cst_cofins', a.cst_cofins, v_cofins),
                             ('cfop_venda', a.cfop_venda, v_cfop), ('cfop_venda_interestadual', a.cfop_venda_interestadual, v_cfop_fora)) c(campo, antes, depois)
  WHERE c.depois IS NOT NULL
    AND (COALESCE(btrim(c.antes),'') = '' OR (v_sobre AND btrim(c.antes) IS DISTINCT FROM c.depois));

  -- total do filtro (para a prévia mostrar "X produtos no filtro, Y mudam")
  SELECT count(*) INTO v_alvo FROM public.erp_produtos p
  WHERE p.company_id = p_company_id
    AND (v_inativos OR COALESCE(p.ativo, true))
    AND (v_servicos OR lower(COALESCE(p.tipo,'')) NOT LIKE '%servi%')
    AND (v_ncm IS NULL OR regexp_replace(COALESCE(p.ncm,''),'\D','','g') = v_ncm)
    AND (v_prefixos IS NULL OR EXISTS (SELECT 1 FROM unnest(v_prefixos) px WHERE regexp_replace(COALESCE(p.ncm,''),'\D','','g') LIKE px || '%'))
    AND (v_grupo IS NULL OR p.grupo = v_grupo)
      AND (v_icms_igual IS NULL OR btrim(COALESCE(p.cst_icms,'')) = v_icms_igual)
    AND (v_sem IS NULL
      OR (v_sem = 'tipo_item_sped' AND COALESCE(btrim(p.tipo_item_sped),'') = '')
      OR (v_sem = 'cst_icms' AND COALESCE(btrim(p.cst_icms),'') = '')
      OR (v_sem = 'cst_pis' AND COALESCE(btrim(p.cst_pis),'') = '')
      OR (v_sem = 'cst_cofins' AND COALESCE(btrim(p.cst_cofins),'') = '')
        OR (v_sem = 'cfop_venda' AND COALESCE(btrim(p.cfop_venda),'') = '')
        OR (v_sem = 'cfop_venda_interestadual' AND COALESCE(btrim(p.cfop_venda_interestadual),'') = '')
      OR (v_sem = 'algum' AND (COALESCE(btrim(p.tipo_item_sped),'') = '' OR COALESCE(btrim(p.cst_icms),'') = ''
                               OR COALESCE(btrim(p.cst_pis),'') = '' OR COALESCE(btrim(p.cst_cofins),'') = ''
                                 OR COALESCE(btrim(p.cfop_venda),'') = '')));

  SELECT count(DISTINCT produto_id), count(*) INTO v_prod_mudam, v_campos FROM _pfm_mudanca;
  SELECT COALESCE(jsonb_object_agg(campo, jsonb_build_object('preenche', preenche, 'substitui', substitui)), '{}'::jsonb)
    INTO v_por_campo
  FROM (SELECT campo, count(*) FILTER (WHERE antes IS NULL) preenche, count(*) FILTER (WHERE antes IS NOT NULL) substitui
        FROM _pfm_mudanca GROUP BY campo) x;
  SELECT COALESCE(jsonb_agg(x.o), '[]'::jsonb) INTO v_amostra FROM (
    SELECT jsonb_build_object('codigo', codigo, 'nome', nome, 'ncm', ncm,
             'mudancas', jsonb_agg(jsonb_build_object('campo', campo, 'antes', antes, 'depois', depois) ORDER BY campo)) o
    FROM _pfm_mudanca GROUP BY produto_id, codigo, nome, ncm ORDER BY codigo LIMIT 20) x;

  IF NOT COALESCE(p_aplicar, false) THEN
    RETURN jsonb_build_object('ok', true, 'aplicado', false, 'simples', v_simples, 'regime', v_regime,
      'produtos_no_filtro', v_alvo, 'produtos_mudam', v_prod_mudam, 'campos_mudam', v_campos,
      'por_campo', v_por_campo, 'amostra', v_amostra);
  END IF;

  IF v_prod_mudam = 0 THEN
    RETURN jsonb_build_object('ok', true, 'aplicado', false, 'simples', v_simples, 'regime', v_regime,
      'produtos_no_filtro', v_alvo, 'produtos_mudam', 0, 'campos_mudam', 0, 'por_campo', v_por_campo,
      'amostra', v_amostra, 'mensagem', 'Nada a alterar com esse filtro e esses valores.');
  END IF;

  -- ── aplica: lote + antes/depois de cada campo + update ─────────────────────────────────────────────────
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  INSERT INTO public.erp_produto_fiscal_lote (company_id, filtro, valores, sobrescrever, observacao, produtos_alterados, campos_alterados, usuario_id, usuario_email)
  VALUES (p_company_id, COALESCE(p_filtro,'{}'::jsonb),
          jsonb_strip_nulls(jsonb_build_object('tipo_item_sped', v_tipo, 'cst_icms', v_icms, 'cst_pis', v_pis, 'cst_cofins', v_cofins,
            'cfop_venda', v_cfop, 'cfop_venda_interestadual', v_cfop_fora)),
          v_sobre, v_obs, v_prod_mudam, v_campos, auth.uid(), v_email)
  RETURNING id INTO v_lote;

  INSERT INTO public.erp_produto_fiscal_alteracao (lote_id, company_id, produto_id, campo, valor_antes, valor_depois)
  SELECT v_lote, p_company_id, produto_id, campo, antes, depois FROM _pfm_mudanca;

  UPDATE public.erp_produtos p SET
    tipo_item_sped = COALESCE((SELECT m.depois FROM _pfm_mudanca m WHERE m.produto_id = p.id AND m.campo = 'tipo_item_sped'), p.tipo_item_sped),
    cst_icms       = COALESCE((SELECT m.depois FROM _pfm_mudanca m WHERE m.produto_id = p.id AND m.campo = 'cst_icms'), p.cst_icms),
    cst_pis        = COALESCE((SELECT m.depois FROM _pfm_mudanca m WHERE m.produto_id = p.id AND m.campo = 'cst_pis'), p.cst_pis),
    cst_cofins     = COALESCE((SELECT m.depois FROM _pfm_mudanca m WHERE m.produto_id = p.id AND m.campo = 'cst_cofins'), p.cst_cofins),
    cfop_venda     = COALESCE((SELECT m.depois FROM _pfm_mudanca m WHERE m.produto_id = p.id AND m.campo = 'cfop_venda'), p.cfop_venda),
    cfop_venda_interestadual = COALESCE((SELECT m.depois FROM _pfm_mudanca m WHERE m.produto_id = p.id AND m.campo = 'cfop_venda_interestadual'), p.cfop_venda_interestadual),
    fiscal_observacao = COALESCE(v_obs, p.fiscal_observacao),
    updated_at = now()
  WHERE p.company_id = p_company_id AND p.id IN (SELECT DISTINCT produto_id FROM _pfm_mudanca);

  RETURN jsonb_build_object('ok', true, 'aplicado', true, 'lote_id', v_lote, 'simples', v_simples, 'regime', v_regime,
    'produtos_no_filtro', v_alvo, 'produtos_mudam', v_prod_mudam, 'campos_mudam', v_campos,
    'por_campo', v_por_campo, 'amostra', v_amostra);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_produtos_fiscal_massa(uuid, jsonb, jsonb, boolean, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_produtos_fiscal_massa(uuid, jsonb, jsonb, boolean, boolean, text) TO authenticated, service_role;

-- 4) pré-voo
create or replace function public.fn_fiscal_previo(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_ok_acesso boolean;
  emp record;
  cfg record;
  v_config jsonb := '[]'::jsonb;
  v_bloq int := 0;
  v_avisos int := 0;
  v_sem_ncm int; v_cst_st int; v_ncm2710 int; v_sem_sped int; v_prod_amostra jsonb;
  v_simples boolean; v_simples_cst int;   -- OS-0179: Simples com CST de regime normal
  v_sem_trib int;   -- 29/09: produto sem CSOSN/CST do ICMS, CST do PIS ou CST da COFINS (a emissão não supõe mais)
  v_provisorio int; -- 30/09: produto com marca da edição em massa (ex.: regra provisória a confirmar com o contador)
  v_dest_sem_ie int; v_dest_amostra jsonb;
  v_nfse jsonb := '{}'::jsonb;   -- Fase 2: bloco NFS-e (aditivo)
begin
  select exists(select 1 from public.user_companies uc where uc.user_id = v_uid and uc.company_id = p_company_id)
      or exists(select 1 from public.users u where u.id = v_uid and u.system_role in ('PS_ADMIN','PS_ADMIN_CVM'))
    into v_ok_acesso;
  if not coalesce(v_ok_acesso, false) then
    raise exception 'sem acesso a esta empresa';
  end if;

  select cnpj, inscricao_estadual, inscricao_municipal, razao_social, regime_tributario into emp
  from public.companies where id = p_company_id;
  v_simples := lower(coalesce(emp.regime_tributario,'')) like '%simples%';
  select provider, ativo, focus_token_vault_id, api_key_encrypted, gov_nfse_municipio_codigo,
         serie_nfe_padrao, regime_tributario, opcao_simples_nacional,
         gov_nfse_municipio_aderido, serie_nfse_padrao, regime_apuracao_sn,
         reforma_ibs_cbs_cst, reforma_ibs_cbs_classif_trib
  into cfg from public.erp_fiscal_provider_config
  where company_id = p_company_id and ativo = true limit 1;

  declare
    ok_provider boolean := cfg.provider is not null;
    ok_token boolean := cfg.focus_token_vault_id is not null or cfg.api_key_encrypted is not null;
    ok_ie boolean := coalesce(btrim(emp.inscricao_estadual), '') <> '';
    ok_mun boolean := coalesce(regexp_replace(coalesce(cfg.gov_nfse_municipio_codigo,''),'\D','','g'), '') ~ '^\d{7}$';
    ok_serie boolean := coalesce(btrim(cfg.serie_nfe_padrao::text), '') <> '';
    ok_regime boolean := coalesce(btrim(cfg.regime_tributario), '') <> ''
        and (lower(coalesce(cfg.regime_tributario,'')) not like '%simples%' or cfg.opcao_simples_nacional is not null);
    ok_im boolean := coalesce(btrim(emp.inscricao_municipal), '') <> '';
  begin
    v_config := jsonb_build_array(
      jsonb_build_object('chave','provider','rotulo','Emissor fiscal ativo (Focus)','ok',ok_provider,'valor',cfg.provider,'severidade','bloqueio'),
      jsonb_build_object('chave','token','rotulo','Token do emissor cadastrado','ok',ok_token,'severidade','bloqueio'),
      jsonb_build_object('chave','ie_emitente','rotulo','Inscrição Estadual da empresa','ok',ok_ie,'valor',emp.inscricao_estadual,'severidade','bloqueio'),
      jsonb_build_object('chave','municipio_ibge','rotulo','Município (código IBGE)','ok',ok_mun,'valor',cfg.gov_nfse_municipio_codigo,'severidade','bloqueio'),
      jsonb_build_object('chave','regime','rotulo','Regime tributário / opção do Simples','ok',ok_regime,'valor',cfg.regime_tributario,'severidade','bloqueio'),
      jsonb_build_object('chave','serie','rotulo','Série da NF-e','ok',ok_serie,'valor',cfg.serie_nfe_padrao,'severidade','aviso'),
      jsonb_build_object('chave','inscricao_municipal','rotulo','Inscrição Municipal (para NFS-e)','ok',ok_im,'valor',emp.inscricao_municipal,'severidade','aviso')
    );
    v_bloq := (case when not ok_provider then 1 else 0 end) + (case when not ok_token then 1 else 0 end)
            + (case when not ok_ie then 1 else 0 end) + (case when not ok_mun then 1 else 0 end)
            + (case when not ok_regime then 1 else 0 end);
    v_avisos := (case when not ok_serie then 1 else 0 end) + (case when not ok_im then 1 else 0 end);
  end;

  select
    count(*) filter (where regexp_replace(coalesce(ncm,''),'\D','','g') !~ '^\d{8}$'),
    count(*) filter (where cst_icms in ('500','60') and (vbcst_ret is null or pst is null or vicms_substituto is null or vicms_st_ret is null)),
    count(*) filter (where regexp_replace(coalesce(ncm,''),'\D','','g') like '2710%' and (combustivel_codigo_anp is null or coalesce(btrim(combustivel_descricao_anp),'')='')),
    count(*) filter (where coalesce(btrim(tipo_item_sped),'')=''),
    count(*) filter (where v_simples and btrim(coalesce(cst_icms,'')) ~ '^\d{2}$'),
    count(*) filter (where (lower(coalesce(tipo,'')) not like '%servi%' and (coalesce(btrim(cst_icms),'')='' or coalesce(btrim(cst_pis),'')='' or coalesce(btrim(cst_cofins),'')='' or coalesce(btrim(cfop_venda),'')=''))),
    count(*) filter (where coalesce(btrim(fiscal_observacao),'') <> '')
  into v_sem_ncm, v_cst_st, v_ncm2710, v_sem_sped, v_simples_cst, v_sem_trib, v_provisorio
  from public.erp_produtos where company_id = p_company_id and coalesce(ativo,true) = true;

  select coalesce(jsonb_agg(x.o), '[]'::jsonb) into v_prod_amostra from (
    select jsonb_build_object('codigo', codigo, 'nome', coalesce(nome,''),
      'motivos', (
        (case when regexp_replace(coalesce(ncm,''),'\D','','g') !~ '^\d{8}$' then jsonb_build_array('NCM ausente/inválido') else '[]'::jsonb end)
        || (case when cst_icms in ('500','60') and (vbcst_ret is null or pst is null or vicms_substituto is null or vicms_st_ret is null) then jsonb_build_array('CST '||cst_icms||' sem ST retido') else '[]'::jsonb end)
        || (case when regexp_replace(coalesce(ncm,''),'\D','','g') like '2710%' and (combustivel_codigo_anp is null or coalesce(btrim(combustivel_descricao_anp),'')='') then jsonb_build_array('NCM 2710 sem ANP') else '[]'::jsonb end)
        || (case when lower(coalesce(tipo,'')) not like '%servi%' and coalesce(btrim(cst_icms),'')='' then jsonb_build_array(case when v_simples then 'sem CSOSN do ICMS' else 'sem CST do ICMS' end) else '[]'::jsonb end)
        || (case when lower(coalesce(tipo,'')) not like '%servi%' and coalesce(btrim(cst_pis),'')='' then jsonb_build_array('sem CST do PIS') else '[]'::jsonb end)
        || (case when lower(coalesce(tipo,'')) not like '%servi%' and coalesce(btrim(cst_cofins),'')='' then jsonb_build_array('sem CST da COFINS') else '[]'::jsonb end)
        || (case when lower(coalesce(tipo,'')) not like '%servi%' and coalesce(btrim(cfop_venda),'')='' then jsonb_build_array('sem CFOP de venda dentro do estado') else '[]'::jsonb end)
        || (case when coalesce(btrim(tipo_item_sped),'')='' then jsonb_build_array('sem tipo do item (SPED)') else '[]'::jsonb end)
        || (case when v_simples and btrim(coalesce(cst_icms,'')) ~ '^\d{2}$' then jsonb_build_array('CST '||btrim(cst_icms)||' (regime normal) — Simples usa CSOSN (ex.: 500 p/ ST já retido)') else '[]'::jsonb end)
      )) as o
    from public.erp_produtos
    where company_id = p_company_id and coalesce(ativo,true) = true
      and (regexp_replace(coalesce(ncm,''),'\D','','g') !~ '^\d{8}$'
        or (cst_icms in ('500','60') and (vbcst_ret is null or pst is null or vicms_substituto is null or vicms_st_ret is null))
        or (regexp_replace(coalesce(ncm,''),'\D','','g') like '2710%' and (combustivel_codigo_anp is null or coalesce(btrim(combustivel_descricao_anp),'')=''))
        or coalesce(btrim(tipo_item_sped),'')=''
        or (v_simples and btrim(coalesce(cst_icms,'')) ~ '^\d{2}$')
        or (lower(coalesce(tipo,'')) not like '%servi%' and (coalesce(btrim(cst_icms),'')='' or coalesce(btrim(cst_pis),'')='' or coalesce(btrim(cst_cofins),'')='' or coalesce(btrim(cfop_venda),'')='')))
    order by (case
                when v_simples and btrim(coalesce(cst_icms,'')) ~ '^\d{2}$' then 0
                when regexp_replace(coalesce(ncm,''),'\D','','g') !~ '^\d{8}$'
                  or (cst_icms in ('500','60') and (vbcst_ret is null or pst is null or vicms_substituto is null or vicms_st_ret is null))
                  or (regexp_replace(coalesce(ncm,''),'\D','','g') like '2710%' and (combustivel_codigo_anp is null or coalesce(btrim(combustivel_descricao_anp),'')=''))
                  or (lower(coalesce(tipo,'')) not like '%servi%' and (coalesce(btrim(cst_icms),'')='' or coalesce(btrim(cst_pis),'')='' or coalesce(btrim(cst_cofins),'')='' or coalesce(btrim(cfop_venda),'')='')) then 1
                else 2 end),
             codigo
    limit 15
  ) x;

  select count(*) into v_dest_sem_ie
  from public.erp_clientes
  where company_id = p_company_id
    and lower(coalesce(contribuinte_icms::text,'')) in ('true','t','1','sim','contribuinte')
    and coalesce(btrim(ie),'') = '';
  select coalesce(jsonb_agg(jsonb_build_object('nome', coalesce(razao_social,''))), '[]'::jsonb) into v_dest_amostra
  from (select razao_social from public.erp_clientes
        where company_id = p_company_id
          and lower(coalesce(contribuinte_icms::text,'')) in ('true','t','1','sim','contribuinte')
          and coalesce(btrim(ie),'') = '' order by razao_social limit 15) d;

  declare
    ok_provider_n boolean := cfg.provider is not null;
    ok_token_n boolean := cfg.focus_token_vault_id is not null or cfg.api_key_encrypted is not null;
    ok_im_n boolean := coalesce(btrim(emp.inscricao_municipal),'') <> '';
    ok_mun_n boolean := coalesce(regexp_replace(coalesce(cfg.gov_nfse_municipio_codigo,''),'\D','','g'),'') ~ '^\d{7}$';
    v_aderido boolean := coalesce(cfg.gov_nfse_municipio_aderido, false);
    v_serie_n text := coalesce(btrim(cfg.serie_nfse_padrao::text),'');
    v_serie_num int := case when coalesce(btrim(cfg.serie_nfse_padrao::text),'') ~ '^\d+$' then cfg.serie_nfse_padrao::int else null end;
    ok_serie_n boolean := v_serie_num is not null and v_serie_num between 1 and 49999;
    ok_regime_n boolean := coalesce(btrim(cfg.regime_tributario),'') <> ''
        and (lower(coalesce(cfg.regime_tributario,'')) not like '%simples%' or cfg.opcao_simples_nacional is not null);
    ok_ibscbs boolean := coalesce(btrim(cfg.reforma_ibs_cbs_cst),'') <> '' and coalesce(btrim(cfg.reforma_ibs_cbs_classif_trib),'') <> '';
    v_cert_fim date;
    ok_cert boolean;
    v_serv_sem int; v_serv_amostra jsonb; v_nfse_bloq int;
  begin
    select validade_fim into v_cert_fim from public.erp_certificados_a1
      where company_id = p_company_id and removido_em is null order by validade_fim desc limit 1;
    ok_cert := v_cert_fim is not null and v_cert_fim >= current_date;

    select count(*) into v_serv_sem from public.erp_produtos
      where company_id = p_company_id and coalesce(ativo,true) = true
        and lower(coalesce(tipo,'')) like '%servi%' and coalesce(btrim(cod_lista_servico),'') = '';
    select coalesce(jsonb_agg(jsonb_build_object('codigo',codigo,'nome',coalesce(nome,''))),'[]'::jsonb) into v_serv_amostra
      from (select codigo, nome from public.erp_produtos
            where company_id = p_company_id and coalesce(ativo,true) = true
              and lower(coalesce(tipo,'')) like '%servi%' and coalesce(btrim(cod_lista_servico),'') = ''
            order by codigo limit 15) s;

    v_nfse_bloq := (case when not ok_provider_n then 1 else 0 end) + (case when not ok_token_n then 1 else 0 end)
      + (case when not ok_im_n then 1 else 0 end) + (case when not ok_mun_n then 1 else 0 end)
      + (case when not ok_serie_n then 1 else 0 end) + (case when not ok_regime_n then 1 else 0 end)
      + (case when not ok_cert then 1 else 0 end) + (case when v_serv_sem > 0 then 1 else 0 end);

    v_nfse := jsonb_build_object(
      'config', jsonb_build_array(
        jsonb_build_object('chave','provider','rotulo','Emissor NFS-e ativo','ok',ok_provider_n,'valor',cfg.provider,'severidade','bloqueio'),
        jsonb_build_object('chave','token','rotulo','Token do emissor cadastrado','ok',ok_token_n,'severidade','bloqueio'),
        jsonb_build_object('chave','inscricao_municipal','rotulo','Inscrição Municipal preenchida (a real, não o indicador)','ok',ok_im_n,'valor',emp.inscricao_municipal,'severidade','bloqueio'),
        jsonb_build_object('chave','municipio_ibge','rotulo','Município emissor (código IBGE, 7 dígitos)','ok',ok_mun_n,'valor',cfg.gov_nfse_municipio_codigo,'severidade','bloqueio'),
        jsonb_build_object('chave','municipio_aderido','rotulo','Município aderido ao Nacional','ok',v_aderido,'valor',v_aderido,'severidade','aviso'),
        jsonb_build_object('chave','serie_nfse','rotulo','Série NFS-e na faixa de INTEGRAÇÃO (00001–49999, não a do portal)','ok',ok_serie_n,'valor',v_serie_n,'severidade','bloqueio'),
        jsonb_build_object('chave','regime','rotulo','Regime tributário coerente com a opção do Simples','ok',ok_regime_n,'valor',cfg.regime_tributario,'severidade','bloqueio'),
        jsonb_build_object('chave','ibs_cbs','rotulo','IBS/CBS: CST e cClassTrib configurados','ok',ok_ibscbs,'valor',coalesce(cfg.reforma_ibs_cbs_cst,'')||' / '||coalesce(cfg.reforma_ibs_cbs_classif_trib,''),'severidade','aviso'),
        jsonb_build_object('chave','certificado','rotulo','Certificado A1 válido (não vencido)','ok',ok_cert,'valor',v_cert_fim,'severidade','bloqueio')
      ),
      'servicos', jsonb_build_object(
        'sem_codigo_servico', v_serv_sem,
        'amostra', v_serv_amostra,
        'obs_iss', 'Código de serviço (LC 116) é obrigatório por serviço; a alíquota de ISS é resolvida pelo município/Focus na emissão.'
      ),
      'resumo', jsonb_build_object('bloqueios', v_nfse_bloq, 'pronto_para_nfse', (v_nfse_bloq = 0))
    );
  end;

  return jsonb_build_object(
    'config', v_config,
    'produtos', jsonb_build_object(
      'incompletos', coalesce(v_sem_ncm,0)+coalesce(v_cst_st,0)+coalesce(v_ncm2710,0)+coalesce(v_sem_sped,0)+coalesce(v_simples_cst,0)+coalesce(v_sem_trib,0),
      'sem_ncm', v_sem_ncm, 'cst_st_incompleto', v_cst_st, 'ncm2710_sem_anp', v_ncm2710, 'sem_tipo_item_sped', v_sem_sped,
      'simples_cst_regime_normal', v_simples_cst,
      'sem_tributacao', v_sem_trib,
      'fiscal_provisorio', v_provisorio,
      'amostra', v_prod_amostra),
    'destinatarios', jsonb_build_object('contribuinte_sem_ie', v_dest_sem_ie, 'amostra', v_dest_amostra),
    'resumo', jsonb_build_object(
      'config_bloqueios', v_bloq, 'config_avisos', v_avisos,
      'produtos_incompletos', coalesce(v_sem_ncm,0)+coalesce(v_cst_st,0)+coalesce(v_ncm2710,0)+coalesce(v_sem_sped,0)+coalesce(v_simples_cst,0)+coalesce(v_sem_trib,0),
      'destinatarios_pendentes', v_dest_sem_ie,
      'pronto_para_emitir', (v_bloq = 0))
  ) || jsonb_build_object('nfse', v_nfse);
end;
$fn$;
revoke all on function public.fn_fiscal_previo(uuid) from public;
revoke all on function public.fn_fiscal_previo(uuid) from anon;
grant execute on function public.fn_fiscal_previo(uuid) to authenticated, service_role;

UPDATE public.manual_operacional SET
  conteudo_markdown = replace(conteudo_markdown,
    '## Ficha do produto',
    E'## CFOP de venda (desde 30/09)\n- Cada produto tem **CFOP de venda dentro do estado** (5xxx) e **fora do estado** (6xxx). Sem o do destino da nota, a emissão trava dizendo o produto e o campo — não existe mais "5102 automático".\n- Mercadoria com ICMS já retido por ST (CSOSN 500 / CST 60): **5405** dentro e **6404** fora. Demais revendas: **5102** e **6102**.\n- Na edição em massa: use o filtro "Só os com CSOSN/CST do ICMS igual a" (ex.: 500) para aplicar 5405/6404 só nos de ST.\n\n## Ficha do produto'),
  versao = versao + 1, atualizado_em = now()
WHERE id = 'bpo.fiscal.tributacao_produtos' AND position('## CFOP de venda' in conteudo_markdown) = 0;
