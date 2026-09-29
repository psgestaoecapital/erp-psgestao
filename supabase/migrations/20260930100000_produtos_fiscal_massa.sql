-- Edição fiscal EM MASSA de produtos (CEO 29/09). Caso real: FCR com 436 produtos (e FC com 116) sem Tipo do item
-- (SPED), CSOSN/CST do ICMS, CST do PIS e CST da COFINS. A regra quem aprova é o CEO depois do contador; quem aplica é
-- a Jordana, pela tela Cadastros › Produtos › "Edição fiscal em massa". Esta migration só cria a ferramenta —
-- NÃO altera nenhum produto.
--
--  1) erp_produto_fiscal_lote / erp_produto_fiscal_alteracao: quem alterou, quando, com qual filtro, e o antes/depois
--     de CADA campo de CADA produto (dá para auditar e desfazer produto a produto). Só leitura pela API (RLS);
--     escrita só pela função.
--  2) fn_produtos_fiscal_massa(p_company_id, p_filtro, p_valores, p_sobrescrever, p_aplicar):
--     filtro por NCM exato, prefixo de NCM, grupo, "sem o campo X" (ou "sem algum dos 4") ou "todos" (explícito);
--     por padrão só produtos ATIVOS e que não são serviço. p_aplicar=false é a PRÉVIA (quantos mudam, por campo,
--     com amostra); true aplica e registra. Por padrão só PREENCHE o que está vazio; sobrescrever é escolha explícita.
--     Valida cada código contra a tabela oficial e contra o regime da empresa (Simples → CSOSN; normal → CST) —
--     mesma régua de src/lib/produtos/fiscalMassa.ts (gate scripts/check-produtos-fiscal-massa.ts).
--  3) fn_produtos_fiscal_massa_historico(p_company_id): últimos lotes (quem, quando, quantos).
--  4) fn_fiscal_previo: o pré-voo passa a contar e mostrar o produto SEM TRIBUTAÇÃO (sem CSOSN/CST do ICMS, CST do
--     PIS ou CST da COFINS) — a mesma régua que a emissão vai usar quando o "102 automático" sair (PR seguinte).
--     Corpo idêntico ao da 20260926195000 fora a contagem/motivo novos (aditivo: nenhuma chave muda).
--
-- Fontes (RD-72): Guia Prático EFD ICMS/IPI reg. 0200 campo TIPO_ITEM; Tabela B CSOSN (Ajuste SINIEF 03/2010);
-- Tabela B CST ICMS (Convênio s/nº 1970 + Ajustes SINIEF 03/2018 e 01/2023); Tabela 4.3.3 EFD-Contribuições (CST PIS/COFINS).
-- SECURITY DEFINER → REVOKE anon + GRANT (gate check-fn-guards); autoria por auth.uid().

-- 1) registro ------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_produto_fiscal_lote (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  filtro jsonb NOT NULL,
  valores jsonb NOT NULL,
  sobrescrever boolean NOT NULL DEFAULT false,
  produtos_alterados int NOT NULL DEFAULT 0,
  campos_alterados int NOT NULL DEFAULT 0,
  usuario_id uuid,
  usuario_email text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_produto_fiscal_lote_empresa ON public.erp_produto_fiscal_lote(company_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS public.erp_produto_fiscal_alteracao (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lote_id uuid NOT NULL REFERENCES public.erp_produto_fiscal_lote(id),
  company_id uuid NOT NULL,
  produto_id uuid NOT NULL,
  campo text NOT NULL CHECK (campo IN ('tipo_item_sped','cst_icms','cst_pis','cst_cofins')),
  valor_antes text,
  valor_depois text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_produto_fiscal_alteracao_lote ON public.erp_produto_fiscal_alteracao(lote_id);
CREATE INDEX IF NOT EXISTS ix_produto_fiscal_alteracao_produto ON public.erp_produto_fiscal_alteracao(produto_id, criado_em DESC);

ALTER TABLE public.erp_produto_fiscal_lote ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_produto_fiscal_alteracao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS produto_fiscal_lote_select ON public.erp_produto_fiscal_lote;
CREATE POLICY produto_fiscal_lote_select ON public.erp_produto_fiscal_lote FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
DROP POLICY IF EXISTS produto_fiscal_alteracao_select ON public.erp_produto_fiscal_alteracao;
CREATE POLICY produto_fiscal_alteracao_select ON public.erp_produto_fiscal_alteracao FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
REVOKE ALL ON public.erp_produto_fiscal_lote, public.erp_produto_fiscal_alteracao FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.erp_produto_fiscal_lote, public.erp_produto_fiscal_alteracao FROM authenticated;
GRANT SELECT ON public.erp_produto_fiscal_lote, public.erp_produto_fiscal_alteracao TO authenticated;

-- 2) prévia / aplicação --------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_produtos_fiscal_massa(
  p_company_id uuid, p_filtro jsonb, p_valores jsonb, p_sobrescrever boolean DEFAULT false, p_aplicar boolean DEFAULT false)
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
  v_ncm text := NULLIF(regexp_replace(COALESCE(p_filtro->>'ncm',''),'\D','','g'),'');
  v_prefixo text := NULLIF(regexp_replace(COALESCE(p_filtro->>'ncm_prefixo',''),'\D','','g'),'');
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
  IF v_tipo IS NULL AND v_icms IS NULL AND v_pis IS NULL AND v_cofins IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_valor', 'mensagem', 'Escolha o valor de pelo menos um dos 4 campos.');
  END IF;
  IF v_ncm IS NULL AND v_prefixo IS NULL AND v_grupo IS NULL AND v_sem IS NULL AND NOT v_todos THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_filtro',
      'mensagem', 'Escolha um filtro (NCM, prefixo de NCM, grupo ou "sem o campo") ou marque "todos os produtos".');
  END IF;
  IF v_sem IS NOT NULL AND v_sem NOT IN ('tipo_item_sped','cst_icms','cst_pis','cst_cofins','algum') THEN
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
  IF v_cofins IS NOT NULL AND NOT v_cofins = ANY(c_cst_pc) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido', 'campo', 'cst_cofins', 'mensagem', v_cofins || ' não é um CST da COFINS válido.');
  END IF;

  -- ── alvo + mudanças (uma linha por produto × campo que muda) ───────────────────────────────────────────
  CREATE TEMP TABLE IF NOT EXISTS _pfm_mudanca (produto_id uuid, codigo text, nome text, ncm text, campo text, antes text, depois text) ON COMMIT DROP;
  TRUNCATE _pfm_mudanca;

  WITH alvo AS (
    SELECT p.id, p.codigo, p.nome, p.ncm, p.tipo_item_sped, p.cst_icms, p.cst_pis, p.cst_cofins
    FROM public.erp_produtos p
    WHERE p.company_id = p_company_id
      AND (v_inativos OR COALESCE(p.ativo, true))
      AND (v_servicos OR lower(COALESCE(p.tipo,'')) NOT LIKE '%servi%')
      AND (v_ncm IS NULL OR regexp_replace(COALESCE(p.ncm,''),'\D','','g') = v_ncm)
      AND (v_prefixo IS NULL OR regexp_replace(COALESCE(p.ncm,''),'\D','','g') LIKE v_prefixo || '%')
      AND (v_grupo IS NULL OR p.grupo = v_grupo)
      AND (v_sem IS NULL
        OR (v_sem = 'tipo_item_sped' AND COALESCE(btrim(p.tipo_item_sped),'') = '')
        OR (v_sem = 'cst_icms' AND COALESCE(btrim(p.cst_icms),'') = '')
        OR (v_sem = 'cst_pis' AND COALESCE(btrim(p.cst_pis),'') = '')
        OR (v_sem = 'cst_cofins' AND COALESCE(btrim(p.cst_cofins),'') = '')
        OR (v_sem = 'algum' AND (COALESCE(btrim(p.tipo_item_sped),'') = '' OR COALESCE(btrim(p.cst_icms),'') = ''
                                 OR COALESCE(btrim(p.cst_pis),'') = '' OR COALESCE(btrim(p.cst_cofins),'') = '')))
  )
  INSERT INTO _pfm_mudanca
  SELECT a.id, a.codigo, a.nome, a.ncm, c.campo, NULLIF(btrim(c.antes),''), c.depois
  FROM alvo a
  CROSS JOIN LATERAL (VALUES ('tipo_item_sped', a.tipo_item_sped, v_tipo), ('cst_icms', a.cst_icms, v_icms),
                             ('cst_pis', a.cst_pis, v_pis), ('cst_cofins', a.cst_cofins, v_cofins)) c(campo, antes, depois)
  WHERE c.depois IS NOT NULL
    AND (COALESCE(btrim(c.antes),'') = '' OR (v_sobre AND btrim(c.antes) IS DISTINCT FROM c.depois));

  -- total do filtro (para a prévia mostrar "X produtos no filtro, Y mudam")
  SELECT count(*) INTO v_alvo FROM public.erp_produtos p
  WHERE p.company_id = p_company_id
    AND (v_inativos OR COALESCE(p.ativo, true))
    AND (v_servicos OR lower(COALESCE(p.tipo,'')) NOT LIKE '%servi%')
    AND (v_ncm IS NULL OR regexp_replace(COALESCE(p.ncm,''),'\D','','g') = v_ncm)
    AND (v_prefixo IS NULL OR regexp_replace(COALESCE(p.ncm,''),'\D','','g') LIKE v_prefixo || '%')
    AND (v_grupo IS NULL OR p.grupo = v_grupo)
    AND (v_sem IS NULL
      OR (v_sem = 'tipo_item_sped' AND COALESCE(btrim(p.tipo_item_sped),'') = '')
      OR (v_sem = 'cst_icms' AND COALESCE(btrim(p.cst_icms),'') = '')
      OR (v_sem = 'cst_pis' AND COALESCE(btrim(p.cst_pis),'') = '')
      OR (v_sem = 'cst_cofins' AND COALESCE(btrim(p.cst_cofins),'') = '')
      OR (v_sem = 'algum' AND (COALESCE(btrim(p.tipo_item_sped),'') = '' OR COALESCE(btrim(p.cst_icms),'') = ''
                               OR COALESCE(btrim(p.cst_pis),'') = '' OR COALESCE(btrim(p.cst_cofins),'') = '')));

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
  INSERT INTO public.erp_produto_fiscal_lote (company_id, filtro, valores, sobrescrever, produtos_alterados, campos_alterados, usuario_id, usuario_email)
  VALUES (p_company_id, COALESCE(p_filtro,'{}'::jsonb),
          jsonb_strip_nulls(jsonb_build_object('tipo_item_sped', v_tipo, 'cst_icms', v_icms, 'cst_pis', v_pis, 'cst_cofins', v_cofins)),
          v_sobre, v_prod_mudam, v_campos, auth.uid(), v_email)
  RETURNING id INTO v_lote;

  INSERT INTO public.erp_produto_fiscal_alteracao (lote_id, company_id, produto_id, campo, valor_antes, valor_depois)
  SELECT v_lote, p_company_id, produto_id, campo, antes, depois FROM _pfm_mudanca;

  UPDATE public.erp_produtos p SET
    tipo_item_sped = COALESCE((SELECT m.depois FROM _pfm_mudanca m WHERE m.produto_id = p.id AND m.campo = 'tipo_item_sped'), p.tipo_item_sped),
    cst_icms       = COALESCE((SELECT m.depois FROM _pfm_mudanca m WHERE m.produto_id = p.id AND m.campo = 'cst_icms'), p.cst_icms),
    cst_pis        = COALESCE((SELECT m.depois FROM _pfm_mudanca m WHERE m.produto_id = p.id AND m.campo = 'cst_pis'), p.cst_pis),
    cst_cofins     = COALESCE((SELECT m.depois FROM _pfm_mudanca m WHERE m.produto_id = p.id AND m.campo = 'cst_cofins'), p.cst_cofins),
    updated_at = now()
  WHERE p.company_id = p_company_id AND p.id IN (SELECT DISTINCT produto_id FROM _pfm_mudanca);

  RETURN jsonb_build_object('ok', true, 'aplicado', true, 'lote_id', v_lote, 'simples', v_simples, 'regime', v_regime,
    'produtos_no_filtro', v_alvo, 'produtos_mudam', v_prod_mudam, 'campos_mudam', v_campos,
    'por_campo', v_por_campo, 'amostra', v_amostra);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_produtos_fiscal_massa(uuid, jsonb, jsonb, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_produtos_fiscal_massa(uuid, jsonb, jsonb, boolean, boolean) TO authenticated, service_role;

-- 3) histórico ------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_produtos_fiscal_massa_historico(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_out jsonb;
BEGIN
  IF NOT (EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = v_uid AND uc.company_id = p_company_id)
          OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_uid AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM'))) THEN
    RAISE EXCEPTION 'sem acesso a esta empresa' USING errcode = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('lote_id', id, 'criado_em', criado_em, 'usuario_email', usuario_email,
           'filtro', filtro, 'valores', valores, 'sobrescrever', sobrescrever,
           'produtos_alterados', produtos_alterados, 'campos_alterados', campos_alterados) ORDER BY criado_em DESC), '[]'::jsonb)
    INTO v_out
  FROM (SELECT * FROM public.erp_produto_fiscal_lote WHERE company_id = p_company_id ORDER BY criado_em DESC LIMIT 20) l;
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_produtos_fiscal_massa_historico(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_produtos_fiscal_massa_historico(uuid) TO authenticated, service_role;

-- 4) pré-voo: produto sem tributação ---------------------------------------------------------------------------
-- Corpo da 20260926195000 com a contagem/motivo 'sem_tributacao' (produto que não é serviço sem CSOSN/CST do ICMS,
-- CST do PIS ou CST da COFINS). Entra na ordem 1 da amostra (trava a emissão quando o 102 automático sair).
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
  v_dest_sem_ie int; v_dest_amostra jsonb;
  v_nfse jsonb := '{}'::jsonb;   -- Fase 2: bloco NFS-e (aditivo)
begin
  -- acesso: membro da empresa OU equipe PS (autoria por auth.uid — gate)
  select exists(select 1 from public.user_companies uc where uc.user_id = v_uid and uc.company_id = p_company_id)
      or exists(select 1 from public.users u where u.id = v_uid and u.system_role in ('PS_ADMIN','PS_ADMIN_CVM'))
    into v_ok_acesso;
  if not coalesce(v_ok_acesso, false) then
    raise exception 'sem acesso a esta empresa';
  end if;

  select cnpj, inscricao_estadual, inscricao_municipal, razao_social, regime_tributario into emp
  from public.companies where id = p_company_id;
  -- mesma fonte e mesmo teste do nfe-builder (ehSimples = companies.regime_tributario contém 'simples')
  v_simples := lower(coalesce(emp.regime_tributario,'')) like '%simples%';
  select provider, ativo, focus_token_vault_id, api_key_encrypted, gov_nfse_municipio_codigo,
         serie_nfe_padrao, regime_tributario, opcao_simples_nacional,
         gov_nfse_municipio_aderido, serie_nfse_padrao, regime_apuracao_sn,
         reforma_ibs_cbs_cst, reforma_ibs_cbs_classif_trib
  into cfg from public.erp_fiscal_provider_config
  where company_id = p_company_id and ativo = true limit 1;

  -- ── Config (mostra o que está CERTO e o que falta) ────────────────────────────────
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

  -- ── Produtos incompletos (mesmos predicados do nfe-validator) ─────────────────────
  select
    count(*) filter (where regexp_replace(coalesce(ncm,''),'\D','','g') !~ '^\d{8}$'),
    count(*) filter (where cst_icms in ('500','60') and (vbcst_ret is null or pst is null or vicms_substituto is null or vicms_st_ret is null)),
    count(*) filter (where regexp_replace(coalesce(ncm,''),'\D','','g') like '2710%' and (combustivel_codigo_anp is null or coalesce(btrim(combustivel_descricao_anp),'')='')),
    count(*) filter (where coalesce(btrim(tipo_item_sped),'')=''),
    count(*) filter (where v_simples and btrim(coalesce(cst_icms,'')) ~ '^\d{2}$'),
    count(*) filter (where (lower(coalesce(tipo,'')) not like '%servi%' and (coalesce(btrim(cst_icms),'')='' or coalesce(btrim(cst_pis),'')='' or coalesce(btrim(cst_cofins),'')='')))
  into v_sem_ncm, v_cst_st, v_ncm2710, v_sem_sped, v_simples_cst, v_sem_trib
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
        or (lower(coalesce(tipo,'')) not like '%servi%' and (coalesce(btrim(cst_icms),'')='' or coalesce(btrim(cst_pis),'')='' or coalesce(btrim(cst_cofins),'')='')))
    -- a amostra mostra PRIMEIRO o que a Focus/SEFAZ recusa (na KGF os 1.725 "sem SPED" enchiam as 15 vagas
    -- e escondiam os 3 da OS-0179); o "sem SPED" (não trava a emissão) vem por último
    order by (case
                when v_simples and btrim(coalesce(cst_icms,'')) ~ '^\d{2}$' then 0
                when regexp_replace(coalesce(ncm,''),'\D','','g') !~ '^\d{8}$'
                  or (cst_icms in ('500','60') and (vbcst_ret is null or pst is null or vicms_substituto is null or vicms_st_ret is null))
                  or (regexp_replace(coalesce(ncm,''),'\D','','g') like '2710%' and (combustivel_codigo_anp is null or coalesce(btrim(combustivel_descricao_anp),'')=''))
                  or (lower(coalesce(tipo,'')) not like '%servi%' and (coalesce(btrim(cst_icms),'')='' or coalesce(btrim(cst_pis),'')='' or coalesce(btrim(cst_cofins),'')='')) then 1
                else 2 end),
             codigo
    limit 15
  ) x;

  -- ── Destinatários contribuintes sem IE (232) ──────────────────────────────────────
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

  -- ── Pré-voo NFS-e (Fase 2 · bloco novo, aditivo) ──────────────────────────────────
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

  -- Retorno original PRESERVADO byte a byte; só concatena a chave nova 'nfse' (aditivo).
  return jsonb_build_object(
    'config', v_config,
    'produtos', jsonb_build_object(
      'incompletos', coalesce(v_sem_ncm,0)+coalesce(v_cst_st,0)+coalesce(v_ncm2710,0)+coalesce(v_sem_sped,0)+coalesce(v_simples_cst,0)+coalesce(v_sem_trib,0),
      'sem_ncm', v_sem_ncm, 'cst_st_incompleto', v_cst_st, 'ncm2710_sem_anp', v_ncm2710, 'sem_tipo_item_sped', v_sem_sped,
      'simples_cst_regime_normal', v_simples_cst,
      'sem_tributacao', v_sem_trib,
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

-- 5) manual vivo da BPO (manual_operacional): muda o fluxo de emissão — registra o passo a passo ---------------------
INSERT INTO public.manual_operacional (id, area_id, categoria, titulo, resumo, conteudo_markdown, ordem, publico_alvo, tags, versao, criado_por)
VALUES ('bpo.fiscal.tributacao_produtos', 'bpo', 'fiscal_emissao',
  'Tributação dos produtos antes de emitir NF-e (edição fiscal em massa)',
  'Produto sem CSOSN/CST do ICMS, CST do PIS ou CST da COFINS não pode ir para a nota com tributação suposta. Preencha em massa pela tela Produtos, só com a regra aprovada.',
  $md$# Tributação dos produtos antes de emitir NF-e

## Regra (CEO 29/09)
- A nota **não sai com tributação suposta**. Até 29/09 o sistema colocava sozinho **CSOSN 102 + PIS/COFINS 04** em produto sem cadastro fiscal (empresa do Simples). Isso vai sair: produto sem **CSOSN/CST do ICMS**, **CST do PIS** ou **CST da COFINS** passa a **travar a emissão**, dizendo o produto e o campo que falta.
- A regra de cada empresa (qual CSOSN/CST por produto ou NCM) **vem do contador e é aprovada pelo CEO**. Não preencha "no chute".

## Onde ver o que falta
- **Pré-voo fiscal** (Configurações › Fiscal): mostra "Sem CSOSN/CST, PIS ou COFINS: N" e a lista dos produtos com o motivo.
- **Cadastros › Produtos** → faixa de pendências fiscais.

## Como preencher em massa (`/dashboard/cadastros/produtos` → **Edição fiscal em massa**)
1. **Quais produtos**: por NCM, prefixo de NCM (ex.: `3214`), grupo, ou "só os que estão sem" algum dos 4 campos. Sem filtro, só marcando "todos os produtos".
2. **Valor de cada campo**: Tipo do item (SPED), CSOSN/CST do ICMS (a tela mostra CSOSN se a empresa é do Simples e CST se é do regime normal), CST do PIS, CST da COFINS. Vazio = não mexe.
3. **Ver prévia**: mostra quantos produtos mudam e o antes → depois (nada é gravado).
4. **Aplicar**: grava. Por padrão **só preenche o que está vazio**; para trocar um valor já preenchido, marque "substituir".
5. Fica registrado **quem aplicou, quando e o antes/depois de cada produto** (histórico no próprio modal).

## Ficha do produto
- A ficha não abre mais com CST 00 / PIS-COFINS 01 / alíquotas 18-1,65-7,6. Campo vazio fica vazio.

## Se a emissão travar
- A mensagem diz: "o produto X (cód. Y) está sem CSOSN do ICMS / CST do PIS / CST da COFINS". Preencha na ficha ou pela edição em massa e emita de novo.
$md$,
  1, ARRAY['jordana','todos_operadores_bpo'], ARRAY['fiscal','nfe','produtos','cst','csosn'], 1, 'claude')
ON CONFLICT (id) DO UPDATE SET titulo = EXCLUDED.titulo, resumo = EXCLUDED.resumo, conteudo_markdown = EXCLUDED.conteudo_markdown,
  tags = EXCLUDED.tags, versao = public.manual_operacional.versao + 1, atualizado_em = now();
