-- Chamado #11065 (Gestão Empresarial · Cadastros › Produtos › "Edição fiscal em massa" e "Padrão fiscal por NCM"):
-- a edição fiscal em massa dava "canceling statement due to statement timeout" em catálogo grande (MECÂNICA PESADA E
-- BORRACHARIA 163: 12.125 produtos ativos, 10.568 sem CFOP/CSOSN) — na prévia E na aplicação, mesmo com 1.751 produtos.
--
-- CAUSA RAIZ (provada: função viva idêntica à da 20261001130000 — md5 02621125…, 13.630 caracteres — e reproduzida numa
-- cópia local com a mesma estrutura de erp_produtos):
--  (1) a função materializava "produto × campo" numa TEMP TABLE sem índice e depois fazia o UPDATE com 6 subqueries
--      correlacionadas sobre ela (uma varredura da temp table por produto por campo → custo O(N²));
--  (2) a prévia pagava a mesma materialização; e o papel `authenticated` (toda chamada da tela) tem statement_timeout = 8 s,
--      então não adianta "otimizar a query única" — tem de rodar em passos curtos, cada um numa transação própria.
-- Diminuir o filtro não resolvia porque o custo é quadrático no nº de produtos do lote.
--
-- O QUE ESTA MIGRATION FAZ (aditiva; NENHUM produto é alterado por ela):
--  A) erp_produto_fiscal_job — fila de aplicações em lotes: progresso, cursor, tentativas, erro, quem pediu. Uma por empresa
--     por vez (índice único parcial). Reaproveita erp_produto_fiscal_lote (a "marca do lote") e erp_produto_fiscal_alteracao
--     (o antes/depois de cada campo de cada produto): o histórico/auditoria continuam os mesmos.
--  B) fn__pfm_alvo_ids / fn__pfm_validar / fn__pfm_processar — o filtro, a validação e o motor numa definição só (internas).
--     Conjuntos (INSERT…SELECT, UPDATE…FROM com join por id): nenhuma subquery correlacionada, nenhuma temp table.
--  C) fn_produtos_fiscal_massa (mesma assinatura): a PRÉVIA agora é só contagem/resumo (agregados + amostra de 20) e a
--     aplicação direta só vale para pouca coisa (até 500 produtos que mudam); acima disso devolve `use_lote_assincrono`.
--  D) fn_produtos_fiscal_job_criar / _processar / _obter / _cancelar — o fluxo em lotes que a tela usa (progresso visível,
--     retomada, cancelamento). Cada passo processa um lote (500; cai pela metade a cada falha/timeout) e commita sozinho.
--  E) fn_produtos_fiscal_job_retomar + pg_cron (1 min) — se o navegador fechar no meio, o servidor continua e termina.
--  F) filtro novo `padrao_ncm` (mesmo motor) — "Padrão fiscal por NCM": aplicar o padrão aos produtos JÁ cadastrados daquele
--     NCM, só os que não têm padrão mais específico (a regra do resolver), só preenchendo o vazio.
--  G) fn_produtos_fiscal_massa_historico só mostra lote que alterou algo (ou está em andamento): reexecutar sem nada a
--     mudar não polui o histórico.
--  H) textos de ajuda ("?", RD-95) de todos os campos/ações novos e antigos da tela.
--
-- Reexecutável: só preenche o vazio (ou substitui, se pedido); produto já correto não gera linha de alteração nem conta.
-- Fontes das tabelas oficiais (RD-72): as mesmas da 20260930100000 (SPED 0200, Tabela B CSOSN/CST, Tabela 4.3.3 PIS/COFINS,
-- Convênio s/nº de 15/12/1970 p/ CFOP) — este arquivo NÃO muda regra fiscal, só o jeito de executar.
-- SECURITY DEFINER → REVOKE anon + GRANT (check-fn-guards); autoria por auth.uid(); guarda de empresa nas que gravam.

-- A) fila de aplicações em lotes ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_produto_fiscal_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  lote_id uuid NOT NULL REFERENCES public.erp_produto_fiscal_lote(id),
  filtro jsonb NOT NULL,
  valores jsonb NOT NULL,
  sobrescrever boolean NOT NULL DEFAULT false,
  observacao text,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','processando','concluido','erro','cancelado')),
  total_alvo int NOT NULL DEFAULT 0,        -- produtos no filtro quando o lote foi pedido
  total_mudam int NOT NULL DEFAULT 0,       -- produtos que a prévia dizia que mudariam
  processados int NOT NULL DEFAULT 0,       -- produtos já varridos (alterados ou já corretos)
  produtos_alterados int NOT NULL DEFAULT 0,
  campos_alterados int NOT NULL DEFAULT 0,
  cursor_id uuid,                           -- último produto varrido (ordem por id)
  tamanho_lote int NOT NULL DEFAULT 500 CHECK (tamanho_lote BETWEEN 25 AND 2000),
  tentativas int NOT NULL DEFAULT 0,        -- falhas seguidas (zera a cada passo que dá certo)
  erro text,
  ultimo_passo_ms int,
  usuario_id uuid,
  usuario_email text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  iniciado_em timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz
);
CREATE INDEX IF NOT EXISTS ix_produto_fiscal_job_empresa ON public.erp_produto_fiscal_job (company_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS ix_produto_fiscal_job_ativo ON public.erp_produto_fiscal_job (atualizado_em) WHERE status IN ('pendente','processando');
-- uma aplicação em lotes por vez por empresa (o banco garante, nem clique duplo nem corrida passam)
CREATE UNIQUE INDEX IF NOT EXISTS ux_produto_fiscal_job_ativo_empresa ON public.erp_produto_fiscal_job (company_id) WHERE status IN ('pendente','processando');
COMMENT ON TABLE public.erp_produto_fiscal_job IS 'Chamado #11065: aplicação da edição fiscal em massa em LOTES (progresso, retomada, cancelamento). Escrita só pelas funções fn_produtos_fiscal_job_*; o antes/depois fica em erp_produto_fiscal_alteracao pelo lote_id.';

ALTER TABLE public.erp_produto_fiscal_job ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS produto_fiscal_job_select ON public.erp_produto_fiscal_job;
CREATE POLICY produto_fiscal_job_select ON public.erp_produto_fiscal_job FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
REVOKE ALL ON public.erp_produto_fiscal_job FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.erp_produto_fiscal_job FROM authenticated;
GRANT SELECT ON public.erp_produto_fiscal_job TO authenticated;
GRANT ALL ON public.erp_produto_fiscal_job TO service_role;

-- B1) o filtro, UMA definição: ids dos produtos-alvo (ordem por id; cursor + limite para varrer em lotes) -----------------
CREATE OR REPLACE FUNCTION public.fn__pfm_alvo_ids(p_company_id uuid, p_filtro jsonb, p_depois_id uuid DEFAULT NULL, p_limite int DEFAULT NULL)
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_icms_igual text := NULLIF(btrim(COALESCE(p_filtro->>'icms_igual','')),'');
  v_ncm text := NULLIF(regexp_replace(COALESCE(p_filtro->>'ncm',''),'\D','','g'),'');
  -- vários prefixos: "3208, 3209 3210;3214" → {3208,3209,3210,3214}
  v_prefixos text[] := (SELECT array_agg(x) FROM regexp_split_to_table(COALESCE(p_filtro->>'ncm_prefixo',''), '[^0-9]+') x WHERE x <> '');
  -- Padrão fiscal por NCM: produtos desse NCM (prefixo) que NÃO têm padrão mais específico (mesma regra do resolver)
  v_padrao text := NULLIF(regexp_replace(COALESCE(p_filtro->>'padrao_ncm',''),'\D','','g'),'');
  v_grupo text := NULLIF(btrim(COALESCE(p_filtro->>'grupo','')),'');
  v_sem text := NULLIF(btrim(COALESCE(p_filtro->>'sem_campo','')),'');
  v_servicos boolean := COALESCE((p_filtro->>'incluir_servicos')::boolean, false);
  v_inativos boolean := COALESCE((p_filtro->>'incluir_inativos')::boolean, false);
  v_ids uuid[];
BEGIN
  SELECT array_agg(s.id ORDER BY s.id) INTO v_ids FROM (
    SELECT p.id
    FROM public.erp_produtos p
    WHERE p.company_id = p_company_id
      AND (p_depois_id IS NULL OR p.id > p_depois_id)
      AND (v_inativos OR COALESCE(p.ativo, true))
      AND (v_servicos OR lower(COALESCE(p.tipo,'')) NOT LIKE '%servi%')
      AND (v_ncm IS NULL OR regexp_replace(COALESCE(p.ncm,''),'\D','','g') = v_ncm)
      AND (v_prefixos IS NULL OR EXISTS (SELECT 1 FROM unnest(v_prefixos) px WHERE regexp_replace(COALESCE(p.ncm,''),'\D','','g') LIKE px || '%'))
      AND (v_padrao IS NULL OR (regexp_replace(COALESCE(p.ncm,''),'\D','','g') LIKE v_padrao || '%'
            AND NOT EXISTS (SELECT 1 FROM public.erp_padrao_fiscal_ncm q
                             WHERE q.company_id = p_company_id AND length(q.ncm) > length(v_padrao)
                               AND regexp_replace(COALESCE(p.ncm,''),'\D','','g') LIKE q.ncm || '%')))
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
    ORDER BY p.id
    LIMIT p_limite
  ) s;
  RETURN COALESCE(v_ids, ARRAY[]::uuid[]);
END;
$function$;

-- B2) a validação (as mesmas regras e mensagens da função antiga; regime decide CSOSN × CST) ----------------------------
CREATE OR REPLACE FUNCTION public.fn__pfm_validar(p_company_id uuid, p_filtro jsonb, p_valores jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
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
  v_prefixos text[] := (SELECT array_agg(x) FROM regexp_split_to_table(COALESCE(p_filtro->>'ncm_prefixo',''), '[^0-9]+') x WHERE x <> '');
  v_padrao text := NULLIF(regexp_replace(COALESCE(p_filtro->>'padrao_ncm',''),'\D','','g'),'');
  v_grupo text := NULLIF(btrim(COALESCE(p_filtro->>'grupo','')),'');
  v_sem text := NULLIF(btrim(COALESCE(p_filtro->>'sem_campo','')),'');
  v_todos boolean := COALESCE((p_filtro->>'todos')::boolean, false);
BEGIN
  SELECT regime_tributario INTO v_regime FROM public.companies WHERE id = p_company_id;
  IF COALESCE(btrim(v_regime),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'regime_indefinido',
      'mensagem', 'A empresa está sem regime tributário. Defina o regime (Simples ou normal) antes: ele decide se o ICMS é CSOSN ou CST.');
  END IF;
  -- mesmo teste do nfe-builder (ehSimples = regime contém 'simples')
  v_simples := lower(v_regime) LIKE '%simples%';

  IF v_tipo IS NULL AND v_icms IS NULL AND v_pis IS NULL AND v_cofins IS NULL AND v_cfop IS NULL AND v_cfop_fora IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_valor', 'mensagem', 'Escolha o valor de pelo menos um dos campos.');
  END IF;
  IF v_ncm IS NULL AND v_prefixos IS NULL AND v_padrao IS NULL AND v_grupo IS NULL AND v_sem IS NULL AND v_icms_igual IS NULL AND NOT v_todos THEN
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
  RETURN jsonb_build_object('ok', true, 'simples', v_simples, 'regime', v_regime);
END;
$function$;

-- B3) o motor: calcula (prévia) ou grava (aplica) as mudanças de UM conjunto de produtos, em comandos de conjunto -----------
-- ci-sem-guarda: fn__pfm_processar — função INTERNA (REVOKE de anon/authenticated; só service_role e as funções
-- fn_produtos_fiscal_massa / fn__pfm_job_passo, que conferem o acesso à empresa antes de chamá-la); não é rota pública.
CREATE OR REPLACE FUNCTION public.fn__pfm_processar(
  p_company_id uuid, p_ids uuid[], p_valores jsonb, p_sobrescrever boolean, p_observacao text, p_lote_id uuid, p_gravar boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tipo text := NULLIF(btrim(COALESCE(p_valores->>'tipo_item_sped','')),'');
  v_icms text := NULLIF(btrim(COALESCE(p_valores->>'cst_icms','')),'');
  v_pis text := NULLIF(btrim(COALESCE(p_valores->>'cst_pis','')),'');
  v_cofins text := NULLIF(btrim(COALESCE(p_valores->>'cst_cofins','')),'');
  v_cfop text := NULLIF(btrim(COALESCE(p_valores->>'cfop_venda','')),'');
  v_cfop_fora text := NULLIF(btrim(COALESCE(p_valores->>'cfop_venda_interestadual','')),'');
  v_sobre boolean := COALESCE(p_sobrescrever, false);
  v_obs text := NULLIF(btrim(COALESCE(p_observacao,'')),'');
  v_prod int; v_campos int; v_por_campo jsonb; v_amostra jsonb;
BEGIN
  IF p_gravar THEN
    IF p_lote_id IS NULL THEN RAISE EXCEPTION 'lote obrigatório para gravar'; END IF;
    -- uma instrução: mudanças (produto × campo que muda) → antes/depois → UPDATE por join (sem subquery por linha)
    WITH alvo AS (
      SELECT p.id, p.tipo_item_sped, p.cst_icms, p.cst_pis, p.cst_cofins, p.cfop_venda, p.cfop_venda_interestadual
      FROM public.erp_produtos p WHERE p.company_id = p_company_id AND p.id = ANY(p_ids)
    ), mud AS (
      SELECT a.id AS produto_id, c.campo, NULLIF(btrim(c.antes),'') AS antes, c.depois
      FROM alvo a
      CROSS JOIN LATERAL (VALUES ('tipo_item_sped', a.tipo_item_sped, v_tipo), ('cst_icms', a.cst_icms, v_icms),
                                 ('cst_pis', a.cst_pis, v_pis), ('cst_cofins', a.cst_cofins, v_cofins),
                                 ('cfop_venda', a.cfop_venda, v_cfop), ('cfop_venda_interestadual', a.cfop_venda_interestadual, v_cfop_fora)) c(campo, antes, depois)
      WHERE c.depois IS NOT NULL
        AND (COALESCE(btrim(c.antes),'') = '' OR (v_sobre AND btrim(c.antes) IS DISTINCT FROM c.depois))
    ), ins AS (
      INSERT INTO public.erp_produto_fiscal_alteracao (lote_id, company_id, produto_id, campo, valor_antes, valor_depois)
      SELECT p_lote_id, p_company_id, m.produto_id, m.campo, m.antes, m.depois FROM mud m
      RETURNING lote_id
    ), novo AS (
      SELECT m.produto_id,
             max(m.depois) FILTER (WHERE m.campo = 'tipo_item_sped') AS tipo_item_sped,
             max(m.depois) FILTER (WHERE m.campo = 'cst_icms') AS cst_icms,
             max(m.depois) FILTER (WHERE m.campo = 'cst_pis') AS cst_pis,
             max(m.depois) FILTER (WHERE m.campo = 'cst_cofins') AS cst_cofins,
             max(m.depois) FILTER (WHERE m.campo = 'cfop_venda') AS cfop_venda,
             max(m.depois) FILTER (WHERE m.campo = 'cfop_venda_interestadual') AS cfop_venda_interestadual
      FROM mud m GROUP BY m.produto_id
    ), upd AS (
      UPDATE public.erp_produtos p SET
        tipo_item_sped = COALESCE(n.tipo_item_sped, p.tipo_item_sped),
        cst_icms = COALESCE(n.cst_icms, p.cst_icms),
        cst_pis = COALESCE(n.cst_pis, p.cst_pis),
        cst_cofins = COALESCE(n.cst_cofins, p.cst_cofins),
        cfop_venda = COALESCE(n.cfop_venda, p.cfop_venda),
        cfop_venda_interestadual = COALESCE(n.cfop_venda_interestadual, p.cfop_venda_interestadual),
        fiscal_observacao = COALESCE(v_obs, p.fiscal_observacao),
        updated_at = now()
      FROM novo n
      WHERE p.id = n.produto_id AND p.company_id = p_company_id
      RETURNING p.id
    )
    SELECT (SELECT count(*) FROM upd), (SELECT count(*) FROM ins) INTO v_prod, v_campos;
    RETURN jsonb_build_object('produtos', v_prod, 'campos', v_campos);
  END IF;

  -- prévia: só agregados + amostra de 20 (nada é materializado fora desta instrução, nada é gravado)
  WITH alvo AS (
    SELECT p.id, p.codigo, p.nome, p.ncm, p.tipo_item_sped, p.cst_icms, p.cst_pis, p.cst_cofins, p.cfop_venda, p.cfop_venda_interestadual
    FROM public.erp_produtos p WHERE p.company_id = p_company_id AND p.id = ANY(p_ids)
  ), mud AS (
    SELECT a.id AS produto_id, c.campo, NULLIF(btrim(c.antes),'') AS antes, c.depois
    FROM alvo a
    CROSS JOIN LATERAL (VALUES ('tipo_item_sped', a.tipo_item_sped, v_tipo), ('cst_icms', a.cst_icms, v_icms),
                               ('cst_pis', a.cst_pis, v_pis), ('cst_cofins', a.cst_cofins, v_cofins),
                               ('cfop_venda', a.cfop_venda, v_cfop), ('cfop_venda_interestadual', a.cfop_venda_interestadual, v_cfop_fora)) c(campo, antes, depois)
    WHERE c.depois IS NOT NULL
      AND (COALESCE(btrim(c.antes),'') = '' OR (v_sobre AND btrim(c.antes) IS DISTINCT FROM c.depois))
  )
  SELECT (SELECT count(DISTINCT m.produto_id) FROM mud m),
         (SELECT count(*) FROM mud),
         (SELECT COALESCE(jsonb_object_agg(x.campo, jsonb_build_object('preenche', x.preenche, 'substitui', x.substitui)), '{}'::jsonb)
            FROM (SELECT m.campo, count(*) FILTER (WHERE m.antes IS NULL) AS preenche, count(*) FILTER (WHERE m.antes IS NOT NULL) AS substitui
                    FROM mud m GROUP BY m.campo) x),
         (SELECT COALESCE(jsonb_agg(y.o), '[]'::jsonb)
            FROM (SELECT jsonb_build_object('codigo', a.codigo, 'nome', a.nome, 'ncm', a.ncm,
                           'mudancas', jsonb_agg(jsonb_build_object('campo', m.campo, 'antes', m.antes, 'depois', m.depois) ORDER BY m.campo)) AS o
                    FROM mud m JOIN alvo a ON a.id = m.produto_id
                   GROUP BY a.id, a.codigo, a.nome, a.ncm ORDER BY a.codigo LIMIT 20) y)
    INTO v_prod, v_campos, v_por_campo, v_amostra;
  RETURN jsonb_build_object('produtos', v_prod, 'campos', v_campos, 'por_campo', v_por_campo, 'amostra', v_amostra);
END;
$function$;

-- helper: estado do lote em JSON (o que a tela mostra)
CREATE OR REPLACE FUNCTION public.fn__pfm_job_json(j public.erp_produto_fiscal_job)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'id', j.id, 'company_id', j.company_id, 'lote_id', j.lote_id, 'status', j.status,
    'total_alvo', j.total_alvo, 'total_mudam', j.total_mudam, 'processados', j.processados,
    'produtos_alterados', j.produtos_alterados, 'campos_alterados', j.campos_alterados,
    'percentual', CASE WHEN j.status = 'concluido' THEN 100
                       WHEN j.total_alvo > 0 THEN least(100, floor(100.0 * j.processados / j.total_alvo)::int) ELSE 0 END,
    'tamanho_lote', j.tamanho_lote, 'tentativas', j.tentativas, 'erro', j.erro, 'ultimo_passo_ms', j.ultimo_passo_ms,
    'usuario_email', j.usuario_email, 'criado_em', j.criado_em, 'atualizado_em', j.atualizado_em, 'concluido_em', j.concluido_em,
    'valores', j.valores, 'filtro', j.filtro, 'sobrescrever', j.sobrescrever, 'observacao', j.observacao);
$function$;

-- B4) UM passo do lote: varre os próximos `tamanho_lote` produtos (cursor por id), grava e avança o cursor ----------------
-- ci-sem-guarda: fn__pfm_job_passo — função INTERNA (REVOKE de anon/authenticated; só service_role). Quem chama confere
-- o acesso à empresa antes: fn_produtos_fiscal_job_processar (usuário logado) e fn_produtos_fiscal_job_retomar (pg_cron,
-- sem sessão). O alvo vem do job (empresa/filtro/valores fixados quando o lote foi pedido), nunca de parâmetro do cliente.
CREATE OR REPLACE FUNCTION public.fn__pfm_job_passo(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  j public.erp_produto_fiscal_job%ROWTYPE;
  v_ids uuid[]; r jsonb; v_t0 timestamptz := clock_timestamp(); v_ms int;
  v_falhou boolean := false; v_erro text;
BEGIN
  -- trava a linha: o navegador e o worker nunca processam o mesmo lote ao mesmo tempo
  SELECT * INTO j FROM public.erp_produto_fiscal_job WHERE id = p_job_id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.erp_produto_fiscal_job WHERE id = p_job_id) THEN
      RETURN jsonb_build_object('ok', true, 'ocupado', true);   -- outro passo está rodando: só acompanhar
    END IF;
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado', 'mensagem', 'Aplicação em lotes não encontrada.');
  END IF;
  IF j.status NOT IN ('pendente','processando') THEN
    RETURN jsonb_build_object('ok', true, 'job', public.fn__pfm_job_json(j));
  END IF;

  BEGIN   -- sub-transação: se o passo falhar ou estourar o tempo, só ELE desfaz; o lote anterior fica gravado
    v_ids := public.fn__pfm_alvo_ids(j.company_id, j.filtro, j.cursor_id, j.tamanho_lote);
    IF cardinality(v_ids) = 0 THEN
      UPDATE public.erp_produto_fiscal_job SET status = 'concluido', concluido_em = now(), atualizado_em = now(),
             tentativas = 0, erro = NULL WHERE id = j.id;
    ELSE
      r := public.fn__pfm_processar(j.company_id, v_ids, j.valores, j.sobrescrever, j.observacao, j.lote_id, true);
      v_ms := round(extract(epoch FROM clock_timestamp() - v_t0) * 1000)::int;
      UPDATE public.erp_produto_fiscal_job SET
        status = 'processando', iniciado_em = COALESCE(iniciado_em, now()),
        cursor_id = v_ids[cardinality(v_ids)], processados = processados + cardinality(v_ids),
        produtos_alterados = produtos_alterados + (r->>'produtos')::int,
        campos_alterados = campos_alterados + (r->>'campos')::int,
        tentativas = 0, erro = NULL, ultimo_passo_ms = v_ms, atualizado_em = now()
      WHERE id = j.id;
      UPDATE public.erp_produto_fiscal_lote SET
        produtos_alterados = produtos_alterados + (r->>'produtos')::int,
        campos_alterados = campos_alterados + (r->>'campos')::int
      WHERE id = j.lote_id;
    END IF;
  EXCEPTION
    WHEN query_canceled THEN v_falhou := true; v_erro := 'tempo esgotado num lote de ' || j.tamanho_lote || ' produtos';
    WHEN OTHERS THEN v_falhou := true; v_erro := left(SQLERRM, 400);
  END;

  IF v_falhou THEN
    -- lote menor na próxima tentativa (metade, mínimo 25); depois de 5 falhas seguidas para e mostra o motivo (dá para retentar)
    UPDATE public.erp_produto_fiscal_job SET
      tentativas = tentativas + 1, erro = v_erro, tamanho_lote = greatest(25, tamanho_lote / 2), atualizado_em = now(),
      status = CASE WHEN tentativas + 1 >= 5 THEN 'erro' ELSE status END
    WHERE id = j.id;
  END IF;
  SELECT * INTO j FROM public.erp_produto_fiscal_job WHERE id = p_job_id;
  RETURN jsonb_build_object('ok', NOT v_falhou, 'job', public.fn__pfm_job_json(j));
END;
$function$;

-- C) edição em massa (mesma assinatura): prévia só em agregados; aplicação direta só para pouca coisa -------------------
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
  v_ok jsonb; v_ids uuid[]; r jsonb; v_lote uuid; v_email text; v_aplic jsonb;
  v_obs text := NULLIF(btrim(COALESCE(p_observacao,'')),'');
  v_sync_max constant int := 500;   -- acima disso é pelo fluxo em lotes (fn_produtos_fiscal_job_*)
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'login obrigatório' USING errcode = '42501'; END IF;
  IF NOT (EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = v_uid AND uc.company_id = p_company_id)
          OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_uid AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM'))) THEN
    RAISE EXCEPTION 'sem acesso a esta empresa' USING errcode = '42501';
  END IF;
  PERFORM public.fn__guarda_empresa(p_company_id);

  v_ok := public.fn__pfm_validar(p_company_id, p_filtro, p_valores);
  IF NOT COALESCE((v_ok->>'ok')::boolean, false) THEN RETURN v_ok; END IF;

  v_ids := public.fn__pfm_alvo_ids(p_company_id, p_filtro);
  r := public.fn__pfm_processar(p_company_id, v_ids, p_valores, p_sobrescrever, v_obs, NULL, false);   -- prévia: nada é gravado

  IF NOT COALESCE(p_aplicar, false) THEN
    RETURN jsonb_build_object('ok', true, 'aplicado', false, 'simples', v_ok->'simples', 'regime', v_ok->>'regime',
      'produtos_no_filtro', cardinality(v_ids), 'produtos_mudam', (r->>'produtos')::int, 'campos_mudam', (r->>'campos')::int,
      'por_campo', r->'por_campo', 'amostra', r->'amostra');
  END IF;

  IF (r->>'produtos')::int = 0 THEN
    RETURN jsonb_build_object('ok', true, 'aplicado', false, 'simples', v_ok->'simples', 'regime', v_ok->>'regime',
      'produtos_no_filtro', cardinality(v_ids), 'produtos_mudam', 0, 'campos_mudam', 0, 'por_campo', r->'por_campo',
      'amostra', r->'amostra', 'mensagem', 'Nada a alterar com esse filtro e esses valores.');
  END IF;
  IF (r->>'produtos')::int > v_sync_max THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'use_lote_assincrono', 'produtos_mudam', (r->>'produtos')::int,
      'mensagem', (r->>'produtos') || ' produtos mudam: para esse volume a aplicação é feita em lotes, com barra de progresso. '
                  || 'Atualize a página e use "Aplicar" na Edição fiscal em massa.');
  END IF;

  -- pouca coisa (≤ 500 produtos que mudam): aplica agora, uma transação só, com lote + antes/depois
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  INSERT INTO public.erp_produto_fiscal_lote (company_id, filtro, valores, sobrescrever, observacao, produtos_alterados, campos_alterados, usuario_id, usuario_email)
  VALUES (p_company_id, COALESCE(p_filtro,'{}'::jsonb),
          jsonb_strip_nulls(jsonb_build_object('tipo_item_sped', NULLIF(btrim(COALESCE(p_valores->>'tipo_item_sped','')),''),
            'cst_icms', NULLIF(btrim(COALESCE(p_valores->>'cst_icms','')),''), 'cst_pis', NULLIF(btrim(COALESCE(p_valores->>'cst_pis','')),''),
            'cst_cofins', NULLIF(btrim(COALESCE(p_valores->>'cst_cofins','')),''), 'cfop_venda', NULLIF(btrim(COALESCE(p_valores->>'cfop_venda','')),''),
            'cfop_venda_interestadual', NULLIF(btrim(COALESCE(p_valores->>'cfop_venda_interestadual','')),''))),
          COALESCE(p_sobrescrever, false), v_obs, 0, 0, auth.uid(), v_email)
  RETURNING id INTO v_lote;
  v_aplic := public.fn__pfm_processar(p_company_id, v_ids, p_valores, p_sobrescrever, v_obs, v_lote, true);
  UPDATE public.erp_produto_fiscal_lote SET produtos_alterados = (v_aplic->>'produtos')::int, campos_alterados = (v_aplic->>'campos')::int
   WHERE id = v_lote;
  RETURN jsonb_build_object('ok', true, 'aplicado', true, 'lote_id', v_lote, 'simples', v_ok->'simples', 'regime', v_ok->>'regime',
    'produtos_no_filtro', cardinality(v_ids), 'produtos_mudam', (v_aplic->>'produtos')::int, 'campos_mudam', (v_aplic->>'campos')::int,
    'por_campo', r->'por_campo', 'amostra', r->'amostra');
END;
$function$;

-- D1) pede a aplicação em lotes: valida, confere que há o que mudar, cria o lote (auditoria) e a fila ---------------------
CREATE OR REPLACE FUNCTION public.fn_produtos_fiscal_job_criar(
  p_company_id uuid, p_filtro jsonb, p_valores jsonb, p_sobrescrever boolean DEFAULT false, p_observacao text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ok jsonb; v_ids uuid[]; r jsonb; v_lote uuid; v_job uuid; v_email text; v_ativo uuid;
  v_obs text := NULLIF(btrim(COALESCE(p_observacao,'')),'');
  v_vals jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'login obrigatório' USING errcode = '42501'; END IF;
  IF NOT (EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = v_uid AND uc.company_id = p_company_id)
          OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_uid AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM'))) THEN
    RAISE EXCEPTION 'sem acesso a esta empresa' USING errcode = '42501';
  END IF;
  PERFORM public.fn__guarda_empresa(p_company_id);

  v_ok := public.fn__pfm_validar(p_company_id, p_filtro, p_valores);
  IF NOT COALESCE((v_ok->>'ok')::boolean, false) THEN RETURN v_ok; END IF;

  SELECT id INTO v_ativo FROM public.erp_produto_fiscal_job WHERE company_id = p_company_id AND status IN ('pendente','processando');
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'lote_em_andamento', 'job_id', v_ativo,
      'mensagem', 'Já existe uma aplicação em lotes em andamento nesta empresa. Acompanhe (ou cancele) antes de pedir outra.');
  END IF;

  v_ids := public.fn__pfm_alvo_ids(p_company_id, p_filtro);
  r := public.fn__pfm_processar(p_company_id, v_ids, p_valores, p_sobrescrever, v_obs, NULL, false);
  IF (r->>'produtos')::int = 0 THEN
    RETURN jsonb_build_object('ok', true, 'aplicado', false, 'produtos_no_filtro', cardinality(v_ids), 'produtos_mudam', 0,
      'mensagem', 'Nada a alterar com esse filtro e esses valores.');
  END IF;

  v_vals := jsonb_strip_nulls(jsonb_build_object(
    'tipo_item_sped', NULLIF(btrim(COALESCE(p_valores->>'tipo_item_sped','')),''), 'cst_icms', NULLIF(btrim(COALESCE(p_valores->>'cst_icms','')),''),
    'cst_pis', NULLIF(btrim(COALESCE(p_valores->>'cst_pis','')),''), 'cst_cofins', NULLIF(btrim(COALESCE(p_valores->>'cst_cofins','')),''),
    'cfop_venda', NULLIF(btrim(COALESCE(p_valores->>'cfop_venda','')),''),
    'cfop_venda_interestadual', NULLIF(btrim(COALESCE(p_valores->>'cfop_venda_interestadual','')),'')));
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  BEGIN
    INSERT INTO public.erp_produto_fiscal_lote (company_id, filtro, valores, sobrescrever, observacao, produtos_alterados, campos_alterados, usuario_id, usuario_email)
    VALUES (p_company_id, COALESCE(p_filtro,'{}'::jsonb), v_vals, COALESCE(p_sobrescrever, false), v_obs, 0, 0, auth.uid(), v_email)
    RETURNING id INTO v_lote;
    INSERT INTO public.erp_produto_fiscal_job (company_id, lote_id, filtro, valores, sobrescrever, observacao, status, total_alvo, total_mudam, usuario_id, usuario_email)
    VALUES (p_company_id, v_lote, COALESCE(p_filtro,'{}'::jsonb), v_vals, COALESCE(p_sobrescrever, false), v_obs, 'pendente',
            cardinality(v_ids), (r->>'produtos')::int, auth.uid(), v_email)
    RETURNING id INTO v_job;
  EXCEPTION WHEN unique_violation THEN   -- corrida: outra aplicação entrou entre a conferência e o insert
    SELECT id INTO v_ativo FROM public.erp_produto_fiscal_job WHERE company_id = p_company_id AND status IN ('pendente','processando');
    RETURN jsonb_build_object('ok', false, 'erro', 'lote_em_andamento', 'job_id', v_ativo,
      'mensagem', 'Já existe uma aplicação em lotes em andamento nesta empresa. Acompanhe (ou cancele) antes de pedir outra.');
  END;
  RETURN jsonb_build_object('ok', true, 'aplicado', false, 'job_id', v_job, 'lote_id', v_lote, 'total_alvo', cardinality(v_ids),
    'total_mudam', (r->>'produtos')::int, 'campos_mudam', (r->>'campos')::int);
END;
$function$;

-- D2) processa o próximo lote (a tela chama em sequência até concluir; p_retentar volta uma aplicação parada por erro) ----
CREATE OR REPLACE FUNCTION public.fn_produtos_fiscal_job_processar(p_job_id uuid, p_retentar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_company uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'login obrigatório' USING errcode = '42501'; END IF;
  SELECT company_id INTO v_company FROM public.erp_produto_fiscal_job WHERE id = p_job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado', 'mensagem', 'Aplicação em lotes não encontrada.');
  END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF COALESCE(p_retentar, false) THEN
    -- uma aplicação que parou por erro volta a andar (zera as falhas; lote pela metade do que estourou)
    UPDATE public.erp_produto_fiscal_job SET status = 'processando', tentativas = 0, erro = NULL, atualizado_em = now()
     WHERE id = p_job_id AND status = 'erro';
  END IF;
  RETURN public.fn__pfm_job_passo(p_job_id);
END;
$function$;

-- D3) estado: a aplicação pedida (p_job_id) ou a mais recente da empresa (a tela abre e retoma a que estiver andando) ------
CREATE OR REPLACE FUNCTION public.fn_produtos_fiscal_job_obter(p_company_id uuid, p_job_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); j public.erp_produto_fiscal_job%ROWTYPE;
BEGIN
  IF NOT (EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = v_uid AND uc.company_id = p_company_id)
          OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_uid AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM'))) THEN
    RAISE EXCEPTION 'sem acesso a esta empresa' USING errcode = '42501';
  END IF;
  IF p_job_id IS NOT NULL THEN
    SELECT * INTO j FROM public.erp_produto_fiscal_job WHERE id = p_job_id AND company_id = p_company_id;
  ELSE
    SELECT * INTO j FROM public.erp_produto_fiscal_job
     WHERE company_id = p_company_id AND (status IN ('pendente','processando','erro') OR criado_em > now() - interval '1 day')
     ORDER BY (status IN ('pendente','processando')) DESC, criado_em DESC LIMIT 1;
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'job', NULL); END IF;
  RETURN jsonb_build_object('ok', true, 'job', public.fn__pfm_job_json(j));
END;
$function$;

-- D4) cancela (o que já foi gravado fica — está no antes/depois do lote; reexecutar continua de onde parou, sem duplicar) ---
CREATE OR REPLACE FUNCTION public.fn_produtos_fiscal_job_cancelar(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_company uuid; j public.erp_produto_fiscal_job%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'login obrigatório' USING errcode = '42501'; END IF;
  SELECT company_id INTO v_company FROM public.erp_produto_fiscal_job WHERE id = p_job_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  UPDATE public.erp_produto_fiscal_job SET status = 'cancelado', concluido_em = now(), atualizado_em = now()
   WHERE id = p_job_id AND status IN ('pendente','processando','erro');
  SELECT * INTO j FROM public.erp_produto_fiscal_job WHERE id = p_job_id;
  RETURN jsonb_build_object('ok', true, 'job', public.fn__pfm_job_json(j));
END;
$function$;

-- D5) opções dos filtros (NCM com contagem + grupos) numa agregação só: a tela lia até 10.000 linhas de erp_produtos para
-- montar essas listas — outra fonte de "statement timeout" em catálogo grande, e o PostgREST ainda cortava em 1.000 linhas.
CREATE OR REPLACE FUNCTION public.fn_produtos_fiscal_filtros(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'login obrigatório' USING errcode = '42501'; END IF;
  IF NOT (EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = v_uid AND uc.company_id = p_company_id)
          OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_uid AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM'))) THEN
    RAISE EXCEPTION 'sem acesso a esta empresa' USING errcode = '42501';
  END IF;
  PERFORM public.fn__guarda_empresa(p_company_id);
  RETURN jsonb_build_object(
    'ncms', (SELECT COALESCE(jsonb_agg(jsonb_build_object('ncm', x.n, 'qtd', x.q) ORDER BY x.n), '[]'::jsonb)
               FROM (SELECT regexp_replace(p.ncm,'\D','','g') AS n, count(*) AS q FROM public.erp_produtos p
                      WHERE p.company_id = p_company_id AND COALESCE(p.ativo, true) AND NULLIF(regexp_replace(COALESCE(p.ncm,''),'\D','','g'),'') IS NOT NULL
                      GROUP BY 1) x),
    'grupos', (SELECT COALESCE(jsonb_agg(g.grupo ORDER BY g.grupo), '[]'::jsonb)
                 FROM (SELECT DISTINCT p.grupo FROM public.erp_produtos p
                        WHERE p.company_id = p_company_id AND COALESCE(p.ativo, true) AND NULLIF(btrim(COALESCE(p.grupo,'')),'') IS NOT NULL) g));
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_produtos_fiscal_filtros(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_produtos_fiscal_filtros(uuid) TO authenticated, service_role;

-- E) worker: continua sozinho a aplicação que o navegador largou (parada há mais de 2 min) ---------------------------------
CREATE OR REPLACE FUNCTION public.fn_produtos_fiscal_job_retomar()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; v_j jsonb; v_t0 timestamptz := clock_timestamp(); v_passos int := 0;
BEGIN
  FOR r IN SELECT id FROM public.erp_produto_fiscal_job
            WHERE status IN ('pendente','processando') AND atualizado_em < now() - interval '2 minutes'
            ORDER BY atualizado_em LIMIT 5
  LOOP
    LOOP
      v_j := public.fn__pfm_job_passo(r.id);
      v_passos := v_passos + 1;
      EXIT WHEN COALESCE((v_j->>'ocupado')::boolean, false) OR COALESCE(v_j->'job'->>'status','') NOT IN ('pendente','processando')
             OR clock_timestamp() - v_t0 > interval '15 seconds';
    END LOOP;
    EXIT WHEN clock_timestamp() - v_t0 > interval '15 seconds';
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'passos', v_passos);
END;
$function$;

-- G) histórico: só lote que alterou algo (ou está em andamento) -------------------------------------------------------------
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
           'filtro', filtro, 'valores', valores, 'sobrescrever', sobrescrever, 'observacao', observacao,
           'produtos_alterados', produtos_alterados, 'campos_alterados', campos_alterados) ORDER BY criado_em DESC), '[]'::jsonb)
    INTO v_out
  FROM (SELECT l.* FROM public.erp_produto_fiscal_lote l
         WHERE l.company_id = p_company_id
           AND (l.produtos_alterados > 0
                OR EXISTS (SELECT 1 FROM public.erp_produto_fiscal_job j WHERE j.lote_id = l.id AND j.status IN ('pendente','processando')))
         ORDER BY l.criado_em DESC LIMIT 20) l;
  RETURN v_out;
END;
$function$;

-- ACL: públicas só a logados (REVOKE anon/PUBLIC); internas só service_role --------------------------------------------------
REVOKE ALL ON FUNCTION public.fn_produtos_fiscal_massa(uuid, jsonb, jsonb, boolean, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_produtos_fiscal_massa(uuid, jsonb, jsonb, boolean, boolean, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_produtos_fiscal_job_criar(uuid, jsonb, jsonb, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_produtos_fiscal_job_criar(uuid, jsonb, jsonb, boolean, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_produtos_fiscal_job_processar(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_produtos_fiscal_job_processar(uuid, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_produtos_fiscal_job_obter(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_produtos_fiscal_job_obter(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_produtos_fiscal_job_cancelar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_produtos_fiscal_job_cancelar(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_produtos_fiscal_massa_historico(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_produtos_fiscal_massa_historico(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_produtos_fiscal_job_retomar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_produtos_fiscal_job_retomar() TO service_role;
REVOKE ALL ON FUNCTION public.fn__pfm_alvo_ids(uuid, jsonb, uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__pfm_alvo_ids(uuid, jsonb, uuid, int) TO service_role;
REVOKE ALL ON FUNCTION public.fn__pfm_validar(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__pfm_validar(uuid, jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn__pfm_processar(uuid, uuid[], jsonb, boolean, text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__pfm_processar(uuid, uuid[], jsonb, boolean, text, uuid, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.fn__pfm_job_passo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__pfm_job_passo(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn__pfm_job_json(public.erp_produto_fiscal_job) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__pfm_job_json(public.erp_produto_fiscal_job) TO service_role;

-- E2) agenda o worker (1 min). Idempotente: desagenda antes se já existir. -----------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'produtos-fiscal-job-retomar') THEN
    PERFORM cron.unschedule('produtos-fiscal-job-retomar');
  END IF;
END $$;
SELECT cron.schedule('produtos-fiscal-job-retomar', '* * * * *', $cron$ SELECT public.fn_produtos_fiscal_job_retomar(); $cron$);

-- H) "?" (RD-95) de todos os campos e ações da tela: metadado global, sem dono, sem dado de cliente ---------------------------
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Produto · Edição fiscal em massa', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/cadastros/produtos', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('cadastros.produtos.fiscal_massa.filtro_ncm', 'NCM (filtro)',
  'Escolha um NCM da lista para mexer só nos produtos que têm exatamente esse NCM. O número entre parênteses é quantos produtos têm esse NCM.',
  'Restringe a edição ao grupo de produtos desse NCM, sem tocar nos demais.',
  '87169090 (4.214) — só os produtos com esse NCM.',
  'Escolher um NCM e esperar que produtos de NCM parecido (outro final) também mudem — para isso use o Prefixo.', 1),
 ('cadastros.produtos.fiscal_massa.filtro_prefixo', 'Prefixo do NCM (filtro)',
  'Digite o começo do NCM — um ou vários, separados por vírgula ou espaço. Vale para todos os produtos cujo NCM começa assim.',
  'Pega um capítulo ou posição inteira do NCM de uma vez (todas as autopeças, todos os pneus…).',
  '8708 pega todas as autopeças; "4011, 4016" pega pneus e artefatos de borracha.',
  'Digitar o NCM com pontos ou letras: só contam os números.', 2),
 ('cadastros.produtos.fiscal_massa.filtro_grupo', 'Grupo (filtro)',
  'Escolha um grupo de produtos do cadastro para mexer só nele.',
  'Aplica a regra a um grupo inteiro (ex.: "Filtros") sem olhar o NCM.',
  'Grupo "Pneus".',
  'Esperar que o grupo traga serviços ou produtos inativos: ficam sempre de fora.', 3),
 ('cadastros.produtos.fiscal_massa.filtro_sem', 'Só os que estão sem (filtro)',
  'Escolha qual campo vazio define os produtos a preencher: algum dos campos de tributação, ou um campo específico.',
  'É o jeito mais seguro de completar o cadastro: só entram produtos que realmente estão sem o dado.',
  '"Algum dos campos" para completar tudo que está faltando.',
  'Marcar "não filtrar" sem querer: aí todos os produtos entram no filtro (os já preenchidos só mudam se você marcar "substituir").', 4),
 ('cadastros.produtos.fiscal_massa.filtro_icms_igual', 'Só os com CSOSN/CST igual a (filtro)',
  'Digite o CSOSN (Simples) ou CST (regime normal) que os produtos já têm, para alcançar só esses.',
  'Separa grupos pela tributação que já têm — por exemplo aplicar 5405/6404 só nos de ICMS já retido por ST (500).',
  '500 — só os produtos com ICMS já retido por substituição tributária.',
  'Digitar CST de 2 dígitos numa empresa do Simples (que usa CSOSN de 3).', 5),
 ('cadastros.produtos.fiscal_massa.filtro_todos', 'Todos os produtos (sem filtro)',
  'Marque para aplicar em todos os produtos ativos da empresa. Só aparece quando nenhum outro filtro foi escolhido.',
  'Para catálogo inteiro: a aplicação roda em lotes, com barra de progresso, e pode continuar sozinha se você fechar a tela.',
  'Preencher o catálogo todo com a regra do contador.',
  'Usar "todos" com "substituir" marcado: troca até o que já estava certo. Prefira "só os que estão sem".', 6),
 ('cadastros.produtos.fiscal_massa.valor.tipo_item_sped', 'Tipo do item (SPED)',
  'O tipo do item na EFD (SPED): revenda, matéria-prima, uso e consumo etc. Vazio = não mexe.',
  'A nota e o SPED usam essa classificação; produto sem tipo aparece como pendência fiscal.',
  '00 — Mercadoria para revenda.',
  'Usar 99 (Outras) num item que será vendido em nota.', 7),
 ('cadastros.produtos.fiscal_massa.valor.cst_icms', 'CSOSN/CST do ICMS',
  'A situação tributária do ICMS. A tela mostra CSOSN (3 dígitos) se a empresa é do Simples e CST (2 dígitos) se é do regime normal. Vazio = não mexe.',
  'A NF-e sai com essa situação tributária; sem ela o produto não emite.',
  'Simples: 102 (sem crédito) ou 500 (ICMS já retido por ST).',
  'Usar 102 em mercadoria que tem substituição tributária: a nota sai com tributação errada. Confirme com o contador.', 8),
 ('cadastros.produtos.fiscal_massa.valor.cst_pis', 'CST do PIS',
  'A situação tributária do PIS dos produtos escolhidos. Vazio = não mexe.',
  'A nota não sai sem o CST do PIS do item.',
  '49 (outras operações de saída) ou 01 (tributável).',
  'Deixar vazio num produto que será vendido.', 9),
 ('cadastros.produtos.fiscal_massa.valor.cst_cofins', 'CST da COFINS',
  'A situação tributária da COFINS dos produtos escolhidos. Vazio = não mexe.',
  'A nota não sai sem o CST da COFINS do item.',
  '49 (outras operações de saída) ou 01 (tributável).',
  'Usar um CST de PIS diferente do da COFINS sem orientação do contador.', 10),
 ('cadastros.produtos.fiscal_massa.valor.cfop_venda', 'CFOP de venda dentro do estado',
  'O CFOP das vendas para o mesmo estado (começa com 5). Vazio = não mexe.',
  'A nota de venda dentro do estado usa este CFOP; sem ele o produto não emite.',
  '5102 (revenda) ou 5405 (mercadoria com ICMS já retido por ST).',
  'Pôr um CFOP que não começa com 5.', 11),
 ('cadastros.produtos.fiscal_massa.valor.cfop_venda_interestadual', 'CFOP de venda fora do estado',
  'O CFOP das vendas para outro estado (começa com 6). Vazio = não mexe.',
  'A nota de venda interestadual usa este CFOP; sem ele o produto não emite para outro estado.',
  '6102 (revenda) ou 6404 (mercadoria com ICMS já retido por ST).',
  'Pôr um CFOP que não começa com 6.', 12),
 ('cadastros.produtos.fiscal_massa.sobrescrever', 'Substituir o que já está preenchido',
  'Marque só se quiser trocar também os valores que já estão nos produtos. Desmarcado (padrão), só o campo vazio é preenchido.',
  'Mantém intacto o que alguém já classificou à mão; reexecutar não muda o que já está certo.',
  'Deixar desmarcado ao completar o cadastro; marcar só ao corrigir uma regra errada.',
  'Marcar "substituir" e esquecer: produtos já corretos passam a receber o novo valor.', 13),
 ('cadastros.produtos.fiscal_massa.observacao', 'Marca em cada produto alterado',
  'Opcional: um texto curto gravado em cada produto alterado.',
  'Deixa rastro de que a regra é provisória e aparece no pré-voo fiscal, até o contador confirmar.',
  'regra provisória 23/11 — confirmar com o contador',
  'Deixar vazio numa regra ainda não aprovada pelo contador.', 14),
 ('cadastros.produtos.fiscal_massa.previa', 'Ver prévia',
  'Toque para ver quantos produtos mudam e uma amostra do antes → depois. Nada é gravado.',
  'Confere o efeito da regra antes de aplicar. A prévia só conta e resume, por isso é rápida mesmo com catálogo grande.',
  '"10.568 de 12.125 produtos no filtro mudam".',
  'Aplicar sem ver a prévia: o botão Aplicar só libera depois dela.', 15),
 ('cadastros.produtos.fiscal_massa.aplicar', 'Aplicar',
  'Toque para gravar. Catálogo grande é aplicado em lotes, com barra de progresso; se você fechar a tela, o servidor continua e termina sozinho.',
  'Grava a classificação fiscal e registra quem alterou, quando e o antes/depois de cada campo de cada produto.',
  '12.125 produtos em lotes de 500, sem estourar o tempo.',
  'Pedir outra aplicação enquanto uma está em andamento: acompanhe ou cancele a atual primeiro.', 16),
 ('cadastros.produtos.fiscal_massa.progresso', 'Andamento da aplicação em lotes',
  'Mostra quantos produtos já foram varridos, quantos foram alterados e o estado do lote. Dá para cancelar; o que já foi gravado fica registrado.',
  'Acompanha aplicações grandes sem travar a tela. Reexecutar depois só completa o que faltou, sem duplicar.',
  'Aplicando… 6.000 de 12.125 produtos (49%).',
  'Achar que cancelar desfaz o que já foi gravado: não desfaz; o antes/depois permite corrigir produto a produto.', 17),
 ('cadastros.produtos.padrao_fiscal.aplicar_existentes', 'Aplicar aos produtos já cadastrados',
  'Toque para preencher, com este padrão, os produtos que já existem com este NCM e ainda estão sem o campo. Só entram os que não têm um padrão mais específico.',
  'O padrão por NCM vale sozinho para produtos novos da entrada de nota; este botão leva o mesmo padrão aos que já estavam cadastrados, em lotes, só preenchendo o vazio.',
  'Padrão 8708 → todos os produtos 8708… (menos os que têm um padrão próprio mais específico, como 87081000).',
  'Esperar que o botão troque valores já preenchidos: ele só completa o que está vazio.', 12)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, ordem = EXCLUDED.ordem,
  rota = EXCLUDED.rota, vertical = EXCLUDED.vertical, status = EXCLUDED.status;

-- manual vivo da BPO: registra o passo de catálogo grande (idempotente) ------------------------------------------------------
UPDATE public.manual_operacional SET
  conteudo_markdown = replace(conteudo_markdown,
    '## Ficha do produto',
    E'## Catálogo grande (desde 23/11)\n- A prévia só conta e resume; a aplicação roda **em lotes de 500 produtos**, com barra de progresso, e cada lote é gravado na hora. Se você fechar a tela, o servidor continua e termina sozinho; ao reabrir, a tela mostra o andamento.\n- **Cancelar** para onde está (o que já foi gravado fica no histórico). **Reexecutar** só completa o que faltou — produto já correto não é tocado nem duplicado.\n- **Padrão fiscal por NCM** → botão "Aplicar aos já cadastrados" leva o padrão aos produtos existentes daquele NCM (só o campo vazio; respeita o padrão mais específico).\n\n## Ficha do produto'),
  versao = versao + 1, atualizado_em = now()
WHERE id = 'bpo.fiscal.tributacao_produtos' AND position('## Catálogo grande' in conteudo_markdown) = 0;
