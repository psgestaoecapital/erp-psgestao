-- Hub · Gestão de Permutas — F1 (CEO 12/11, contexto 74dfdb57 + refinamento das 4 planilhas da Trio).
-- Fluxo de caixa de imóvel permutado por obra/serviço/material/dinheiro. NADA de permuta existe hoje (RD-26: novo).
-- Genérico para construtora/incorporadora (RD-102 — nada hardcoded de uma empresa).
--
-- Modelo:
--  • hub_permuta           — o contrato: contratante, ativo (imóvel), tipo (100%$ / 100% permuta / misto),
--                            valor da permuta e do dinheiro, índice de reajuste (ex. CUB-SC) + mês-base.
--  • hub_permuta_movimento — cada quitação (dinheiro, obra, serviço, material, imóvel), com competência (mês da
--                            medição mensal), nota fiscal de origem (nº, CNPJ e empresa emissora — multi-CNPJ) e
--                            vínculo opcional (ref_tipo/ref_id) para a F2.
--  • hub_indice_valor      — série de um índice econômico (CUB etc.) por mês; global (company_id NULL) ou da empresa.
--                            O reajuste acumulado = valor[mês ref] / valor[mês-base].
--
-- Regra do extrato: Valor atualizado (contrato + reajuste do índice) − Σ movimentos = Saldo.
--   Saldo > 0 = saldo devedor; = 0 = quitado; < 0 = pagou a mais; sem movimento = a iniciar.
-- Multi-CNPJ: a permuta é UMA (da obra/contratante); as notas que a quitam vêm de várias empresas do grupo — somam
--   todas. No consolidado, permuta marcada intragrupo não entra nos totais (evita dupla contagem).
--
-- SEGURANÇA: RLS por company_id (get_user_company_ids/is_admin); escrita só pelas funções SECURITY DEFINER
--   fail-closed (RAISE 42501 sem acesso); REVOKE anon; nada é apagado (soft-delete rastreável, RD-98).

-- ───────────────────────────── 1) TABELAS ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.hub_permuta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  obra_id uuid REFERENCES public.projetos_obras(id),
  contratante text NOT NULL CHECK (length(btrim(contratante)) >= 2),
  ativo_descr text NOT NULL CHECK (length(btrim(ativo_descr)) >= 2),
  tipo_contrato text NOT NULL DEFAULT 'misto' CHECK (tipo_contrato IN ('100_dinheiro', '100_permuta', 'misto')),
  pct_permuta numeric(6, 3) CHECK (pct_permuta IS NULL OR pct_permuta BETWEEN 0 AND 100),
  valor_permuta numeric(14, 2) NOT NULL DEFAULT 0 CHECK (valor_permuta >= 0),
  valor_dinheiro numeric(14, 2) NOT NULL DEFAULT 0 CHECK (valor_dinheiro >= 0),
  indice_reajuste text,
  data_base date,
  intragrupo boolean NOT NULL DEFAULT false,
  observacao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid DEFAULT auth.uid(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  excluido_em timestamptz,
  excluido_por uuid
);
CREATE INDEX IF NOT EXISTS ix_hub_permuta_company ON public.hub_permuta (company_id) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS ix_hub_permuta_obra ON public.hub_permuta (obra_id);

CREATE TABLE IF NOT EXISTS public.hub_permuta_movimento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permuta_id uuid NOT NULL REFERENCES public.hub_permuta(id),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  tipo text NOT NULL CHECK (tipo IN ('dinheiro', 'obra', 'servico', 'material', 'imovel')),
  valor numeric(14, 2) NOT NULL CHECK (valor >= 0),
  data date NOT NULL DEFAULT current_date,
  competencia date,
  ref_tipo text CHECK (ref_tipo IS NULL OR ref_tipo IN ('medicao', 'orcamento', 'estoque', 'pagar')),
  ref_id uuid,
  num_nota text,
  cnpj_emissor text,
  empresa_emissora_id uuid REFERENCES public.companies(id),
  observacao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid DEFAULT auth.uid(),
  excluido_em timestamptz,
  excluido_por uuid
);
CREATE INDEX IF NOT EXISTS ix_hub_permuta_mov_permuta ON public.hub_permuta_movimento (permuta_id) WHERE excluido_em IS NULL;

CREATE TABLE IF NOT EXISTS public.hub_indice_valor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id),
  indice text NOT NULL CHECK (length(btrim(indice)) >= 2),
  competencia date NOT NULL,
  valor numeric(16, 6) NOT NULL CHECK (valor > 0),
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid DEFAULT auth.uid()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_hub_indice_global ON public.hub_indice_valor (indice, competencia) WHERE company_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_hub_indice_empresa ON public.hub_indice_valor (company_id, indice, competencia) WHERE company_id IS NOT NULL;

-- ───────────────────────────── 2) RLS ─────────────────────────────
ALTER TABLE public.hub_permuta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_permuta_movimento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_indice_valor ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hub_permuta_select ON public.hub_permuta;
CREATE POLICY hub_permuta_select ON public.hub_permuta FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());

DROP POLICY IF EXISTS hub_permuta_mov_select ON public.hub_permuta_movimento;
CREATE POLICY hub_permuta_mov_select ON public.hub_permuta_movimento FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());

DROP POLICY IF EXISTS hub_indice_valor_select ON public.hub_indice_valor;
CREATE POLICY hub_indice_valor_select ON public.hub_indice_valor FOR SELECT TO authenticated
  USING (company_id IS NULL OR company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());

REVOKE ALL ON public.hub_permuta, public.hub_permuta_movimento, public.hub_indice_valor FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.hub_permuta, public.hub_permuta_movimento, public.hub_indice_valor FROM authenticated;
GRANT SELECT ON public.hub_permuta, public.hub_permuta_movimento, public.hub_indice_valor TO authenticated;

-- ───────────────────────────── 3) HELPERS ─────────────────────────────
-- acesso à empresa (fail-closed)
CREATE OR REPLACE FUNCTION public.fn__permuta_pode(p_company_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT public.is_admin() OR (auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id));
$fn$;
REVOKE ALL ON FUNCTION public.fn__permuta_pode(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn__permuta_pode(uuid) TO authenticated, service_role;

-- fator de reajuste acumulado do índice entre o mês-base e o mês de referência (1.0 se faltar série)
CREATE OR REPLACE FUNCTION public.fn__permuta_fator_reajuste(p_company_id uuid, p_indice text, p_base date, p_ref date)
 RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_base numeric; v_ref numeric;
BEGIN
  IF p_indice IS NULL OR p_base IS NULL THEN RETURN 1; END IF;
  SELECT valor INTO v_base FROM public.hub_indice_valor
    WHERE indice = p_indice AND competencia = date_trunc('month', p_base)::date
      AND (company_id = p_company_id OR company_id IS NULL)
    ORDER BY company_id NULLS LAST LIMIT 1;
  SELECT valor INTO v_ref FROM public.hub_indice_valor
    WHERE indice = p_indice AND competencia = date_trunc('month', COALESCE(p_ref, current_date))::date
      AND (company_id = p_company_id OR company_id IS NULL)
    ORDER BY company_id NULLS LAST LIMIT 1;
  -- sem o mês de referência, usa o último disponível até a referência
  IF v_ref IS NULL THEN
    SELECT valor INTO v_ref FROM public.hub_indice_valor
      WHERE indice = p_indice AND competencia <= date_trunc('month', COALESCE(p_ref, current_date))::date
        AND (company_id = p_company_id OR company_id IS NULL)
      ORDER BY competencia DESC, company_id NULLS LAST LIMIT 1;
  END IF;
  IF v_base IS NULL OR v_ref IS NULL OR v_base = 0 THEN RETURN 1; END IF;
  RETURN round(v_ref / v_base, 6);
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn__permuta_fator_reajuste(uuid, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn__permuta_fator_reajuste(uuid, text, date, date) TO authenticated, service_role;

-- ───────────────────────────── 4) RPCs ─────────────────────────────
-- LISTAR: cartões + linhas (valor atualizado × quitado × saldo × status) no escopo de empresas pedido.
CREATE OR REPLACE FUNCTION public.fn_permuta_listar(p_company_ids uuid[] DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_scope uuid[];
  v_rows jsonb;
  v_cards jsonb;
BEGIN
  IF auth.uid() IS NULL AND NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_sessao');
  END IF;
  -- escopo = empresas pedidas ∩ empresas acessíveis (fail-closed: só o que o usuário pode ver)
  SELECT array_agg(c) INTO v_scope FROM (
    SELECT unnest(COALESCE(p_company_ids, ARRAY(SELECT public.get_user_company_ids()))) AS c
  ) q WHERE public.fn__permuta_pode(q.c);
  IF v_scope IS NULL OR array_length(v_scope, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'permutas', '[]'::jsonb,
      'cartoes', jsonb_build_object('a_receber', 0, 'quitado', 0, 'saldo', 0, 'abertas', 0),
      'consolidado', (COALESCE(array_length(p_company_ids, 1), 0) <> 1));
  END IF;

  WITH base AS (
    SELECT p.*,
      (p.valor_permuta * public.fn__permuta_fator_reajuste(p.company_id, p.indice_reajuste, p.data_base, current_date)) AS valor_atualizado
    FROM public.hub_permuta p
    WHERE p.excluido_em IS NULL AND p.company_id = ANY(v_scope)
      -- no consolidado (mais de uma empresa), tira a permuta intragrupo p/ não contar duas vezes
      AND NOT (p.intragrupo AND COALESCE(array_length(v_scope, 1), 1) > 1)
  ), mov AS (
    SELECT m.permuta_id, COALESCE(sum(m.valor), 0) AS quitado
    FROM public.hub_permuta_movimento m
    JOIN base b ON b.id = m.permuta_id
    WHERE m.excluido_em IS NULL
    GROUP BY m.permuta_id
  ), calc AS (
    SELECT b.id, b.company_id, b.contratante, b.ativo_descr, b.tipo_contrato, b.obra_id,
      b.valor_permuta, b.valor_dinheiro, b.indice_reajuste, b.data_base, b.intragrupo,
      round(b.valor_atualizado, 2) AS valor_atualizado,
      round(COALESCE(mv.quitado, 0), 2) AS quitado,
      round(b.valor_atualizado - COALESCE(mv.quitado, 0), 2) AS saldo,
      cc.razao_social AS empresa_nome,
      ob.nome AS obra_nome
    FROM base b
    LEFT JOIN mov mv ON mv.permuta_id = b.id
    LEFT JOIN public.companies cc ON cc.id = b.company_id
    LEFT JOIN public.projetos_obras ob ON ob.id = b.obra_id
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'company_id', company_id, 'empresa_nome', empresa_nome,
      'contratante', contratante, 'ativo_descr', ativo_descr, 'tipo_contrato', tipo_contrato,
      'obra_id', obra_id, 'obra_nome', obra_nome,
      'valor_permuta', valor_permuta, 'valor_dinheiro', valor_dinheiro,
      'indice_reajuste', indice_reajuste, 'data_base', data_base, 'intragrupo', intragrupo,
      'valor_atualizado', valor_atualizado, 'quitado', quitado, 'saldo', saldo,
      'pct_quitado', CASE WHEN valor_atualizado > 0 THEN round(least(quitado / valor_atualizado, 1) * 100, 1) ELSE 0 END,
      'status', CASE
        WHEN quitado <= 0.005 THEN 'a_iniciar'
        WHEN saldo < -0.005 THEN 'pagou_a_mais'
        WHEN saldo <= 0.005 THEN 'quitado'
        ELSE 'saldo_devedor' END
    ) ORDER BY saldo DESC), '[]'::jsonb),
    jsonb_build_object(
      'a_receber', COALESCE(round(sum(valor_atualizado), 2), 0),
      'quitado', COALESCE(round(sum(quitado), 2), 0),
      'saldo', COALESCE(round(sum(saldo), 2), 0),
      'abertas', COALESCE(count(*) FILTER (WHERE saldo > 0.005), 0))
  INTO v_rows, v_cards FROM calc;

  RETURN jsonb_build_object('ok', true, 'permutas', v_rows, 'cartoes', v_cards,
    'consolidado', (array_length(v_scope, 1) > 1));
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_permuta_listar(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_permuta_listar(uuid[]) TO authenticated, service_role;

-- SALVAR (insert/update) — access check na empresa dona
CREATE OR REPLACE FUNCTION public.fn_permuta_salvar(p_dados jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid := NULLIF(p_dados->>'id', '')::uuid;
  v_company uuid := (p_dados->>'company_id')::uuid;
BEGIN
  IF v_company IS NULL OR NOT public.fn__permuta_pode(v_company) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.hub_permuta (company_id, obra_id, contratante, ativo_descr, tipo_contrato,
      pct_permuta, valor_permuta, valor_dinheiro, indice_reajuste, data_base, intragrupo, observacao)
    VALUES (v_company, NULLIF(p_dados->>'obra_id', '')::uuid, btrim(p_dados->>'contratante'),
      btrim(p_dados->>'ativo_descr'), COALESCE(p_dados->>'tipo_contrato', 'misto'),
      NULLIF(p_dados->>'pct_permuta', '')::numeric, COALESCE(NULLIF(p_dados->>'valor_permuta', '')::numeric, 0),
      COALESCE(NULLIF(p_dados->>'valor_dinheiro', '')::numeric, 0), NULLIF(p_dados->>'indice_reajuste', ''),
      NULLIF(p_dados->>'data_base', '')::date, COALESCE((p_dados->>'intragrupo')::boolean, false),
      NULLIF(p_dados->>'observacao', ''))
    RETURNING id INTO v_id;
  ELSE
    -- confere acesso ao registro existente
    IF NOT EXISTS (SELECT 1 FROM public.hub_permuta WHERE id = v_id AND company_id = v_company AND excluido_em IS NULL) THEN
      RAISE EXCEPTION 'Permuta não encontrada nesta empresa' USING ERRCODE = '42501';
    END IF;
    UPDATE public.hub_permuta SET
      obra_id = NULLIF(p_dados->>'obra_id', '')::uuid,
      contratante = btrim(p_dados->>'contratante'),
      ativo_descr = btrim(p_dados->>'ativo_descr'),
      tipo_contrato = COALESCE(p_dados->>'tipo_contrato', tipo_contrato),
      pct_permuta = NULLIF(p_dados->>'pct_permuta', '')::numeric,
      valor_permuta = COALESCE(NULLIF(p_dados->>'valor_permuta', '')::numeric, 0),
      valor_dinheiro = COALESCE(NULLIF(p_dados->>'valor_dinheiro', '')::numeric, 0),
      indice_reajuste = NULLIF(p_dados->>'indice_reajuste', ''),
      data_base = NULLIF(p_dados->>'data_base', '')::date,
      intragrupo = COALESCE((p_dados->>'intragrupo')::boolean, intragrupo),
      observacao = NULLIF(p_dados->>'observacao', ''),
      atualizado_em = now()
    WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_permuta_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_permuta_salvar(jsonb) TO authenticated, service_role;

-- MOVIMENTO ADD — access check na empresa da permuta e na empresa emissora
CREATE OR REPLACE FUNCTION public.fn_permuta_movimento_add(p_dados jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_permuta uuid := (p_dados->>'permuta_id')::uuid;
  v_dona uuid;
  v_emissora uuid := NULLIF(p_dados->>'empresa_emissora_id', '')::uuid;
  v_id uuid;
BEGIN
  SELECT company_id INTO v_dona FROM public.hub_permuta WHERE id = v_permuta AND excluido_em IS NULL;
  IF v_dona IS NULL OR NOT public.fn__permuta_pode(v_dona) THEN
    RAISE EXCEPTION 'Sem acesso a esta permuta' USING ERRCODE = '42501';
  END IF;
  IF v_emissora IS NOT NULL AND NOT public.fn__permuta_pode(v_emissora) THEN
    RAISE EXCEPTION 'Sem acesso à empresa emissora da nota' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.hub_permuta_movimento (permuta_id, company_id, tipo, valor, data, competencia,
    ref_tipo, ref_id, num_nota, cnpj_emissor, empresa_emissora_id, observacao)
  VALUES (v_permuta, COALESCE(v_emissora, v_dona), p_dados->>'tipo',
    COALESCE(NULLIF(p_dados->>'valor', '')::numeric, 0), COALESCE(NULLIF(p_dados->>'data', '')::date, current_date),
    NULLIF(p_dados->>'competencia', '')::date, NULLIF(p_dados->>'ref_tipo', ''),
    NULLIF(p_dados->>'ref_id', '')::uuid, NULLIF(p_dados->>'num_nota', ''),
    NULLIF(p_dados->>'cnpj_emissor', ''), v_emissora, NULLIF(p_dados->>'observacao', ''))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_permuta_movimento_add(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_permuta_movimento_add(jsonb) TO authenticated, service_role;

-- MOVIMENTO EXCLUIR (soft) — rastreável
CREATE OR REPLACE FUNCTION public.fn_permuta_movimento_excluir(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_dona uuid;
BEGIN
  SELECT p.company_id INTO v_dona FROM public.hub_permuta_movimento m
    JOIN public.hub_permuta p ON p.id = m.permuta_id WHERE m.id = p_id AND m.excluido_em IS NULL;
  IF v_dona IS NULL OR NOT public.fn__permuta_pode(v_dona) THEN
    RAISE EXCEPTION 'Sem acesso a este movimento' USING ERRCODE = '42501';
  END IF;
  UPDATE public.hub_permuta_movimento SET excluido_em = now(), excluido_por = auth.uid() WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_permuta_movimento_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_permuta_movimento_excluir(uuid) TO authenticated, service_role;

-- EXCLUIR permuta (soft) — rastreável
CREATE OR REPLACE FUNCTION public.fn_permuta_excluir(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_dona uuid;
BEGIN
  SELECT company_id INTO v_dona FROM public.hub_permuta WHERE id = p_id AND excluido_em IS NULL;
  IF v_dona IS NULL OR NOT public.fn__permuta_pode(v_dona) THEN
    RAISE EXCEPTION 'Sem acesso a esta permuta' USING ERRCODE = '42501';
  END IF;
  UPDATE public.hub_permuta SET excluido_em = now(), excluido_por = auth.uid() WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_permuta_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_permuta_excluir(uuid) TO authenticated, service_role;

-- EXTRATO: cabeçalho + reajuste + movimentos agrupados por mês (competência) + saldo + status
CREATE OR REPLACE FUNCTION public.fn_permuta_extrato(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_p public.hub_permuta%ROWTYPE;
  v_fator numeric; v_atualizado numeric; v_quitado numeric; v_meses jsonb; v_movs jsonb;
  v_tem_serie boolean;
BEGIN
  SELECT * INTO v_p FROM public.hub_permuta WHERE id = p_id AND excluido_em IS NULL;
  IF v_p.id IS NULL OR NOT public.fn__permuta_pode(v_p.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  v_fator := public.fn__permuta_fator_reajuste(v_p.company_id, v_p.indice_reajuste, v_p.data_base, current_date);
  v_atualizado := round(v_p.valor_permuta * v_fator, 2);
  v_tem_serie := v_p.indice_reajuste IS NOT NULL AND v_p.data_base IS NOT NULL AND v_fator <> 1;

  SELECT COALESCE(sum(valor), 0) INTO v_quitado FROM public.hub_permuta_movimento
    WHERE permuta_id = p_id AND excluido_em IS NULL;

  -- movimentos (linhas)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', m.id, 'tipo', m.tipo, 'valor', m.valor, 'data', m.data, 'competencia', m.competencia,
    'num_nota', m.num_nota, 'cnpj_emissor', m.cnpj_emissor, 'empresa_emissora', ce.razao_social,
    'ref_tipo', m.ref_tipo, 'observacao', m.observacao
  ) ORDER BY COALESCE(m.competencia, m.data) DESC, m.data DESC), '[]'::jsonb)
  INTO v_movs FROM public.hub_permuta_movimento m
  LEFT JOIN public.companies ce ON ce.id = m.empresa_emissora_id
  WHERE m.permuta_id = p_id AND m.excluido_em IS NULL;

  -- agrupado por mês de competência (medição mensal); sem competência cai em "sem mês"
  SELECT COALESCE(jsonb_agg(jsonb_build_object('competencia', comp, 'total', total) ORDER BY comp DESC NULLS LAST), '[]'::jsonb)
  INTO v_meses FROM (
    SELECT date_trunc('month', competencia)::date AS comp, round(sum(valor), 2) AS total
    FROM public.hub_permuta_movimento WHERE permuta_id = p_id AND excluido_em IS NULL
    GROUP BY 1) g;

  RETURN jsonb_build_object('ok', true,
    'permuta', jsonb_build_object('id', v_p.id, 'company_id', v_p.company_id, 'contratante', v_p.contratante,
      'ativo_descr', v_p.ativo_descr, 'tipo_contrato', v_p.tipo_contrato, 'obra_id', v_p.obra_id,
      'valor_permuta', v_p.valor_permuta, 'valor_dinheiro', v_p.valor_dinheiro,
      'indice_reajuste', v_p.indice_reajuste, 'data_base', v_p.data_base, 'observacao', v_p.observacao),
    'reajuste', jsonb_build_object('indice', v_p.indice_reajuste, 'fator', v_fator,
      'acumulado', round(v_atualizado - v_p.valor_permuta, 2), 'tem_serie', v_tem_serie),
    'valor_atualizado', v_atualizado,
    'quitado', round(v_quitado, 2),
    'saldo', round(v_atualizado - v_quitado, 2),
    'status', CASE
      WHEN v_quitado <= 0.005 THEN 'a_iniciar'
      WHEN (v_atualizado - v_quitado) < -0.005 THEN 'pagou_a_mais'
      WHEN (v_atualizado - v_quitado) <= 0.005 THEN 'quitado'
      ELSE 'saldo_devedor' END,
    'por_mes', v_meses,
    'movimentos', v_movs);
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_permuta_extrato(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_permuta_extrato(uuid) TO authenticated, service_role;

-- ───────────────────────────── 5) MENU (module_catalog) ─────────────────────────────
INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, descricao, layer, is_shared)
SELECT 'projetos_permutas', 'Permutas', 'hub', 'repeat', '/dashboard/projetos/permutas', 86, true,
  'Controle de permutas: imóvel permutado por obra, serviço, material ou dinheiro — valor × quitado × saldo, com reajuste por índice e nota fiscal de origem.', '2_svc', false
WHERE NOT EXISTS (SELECT 1 FROM public.module_catalog WHERE id = 'projetos_permutas' OR rota = '/dashboard/projetos/permutas');

-- ───────────────────────────── 6) system_screens (origem do dado RD-98) ─────────────────────────────
INSERT INTO public.system_screens (id, rota, area, titulo, estado_real, prioridade_monitoramento, modulo,
  auditavel_robo, rpcs_chamadas, views_consumidas, criado_em, atualizado_em)
SELECT gen_random_uuid(), '/dashboard/projetos/permutas', 'hub', 'Permutas', 'pronto', 'media', 'hub_projetos', true,
  ARRAY['fn_permuta_listar','fn_permuta_salvar','fn_permuta_movimento_add','fn_permuta_movimento_excluir','fn_permuta_excluir','fn_permuta_extrato']::text[],
  ARRAY['hub_permuta','hub_permuta_movimento','hub_indice_valor','projetos_obras','companies']::text[],
  now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens WHERE rota = '/dashboard/projetos/permutas');

INSERT INTO public.system_screens (id, rota, area, titulo, estado_real, prioridade_monitoramento, modulo,
  auditavel_robo, rpcs_chamadas, views_consumidas, criado_em, atualizado_em)
SELECT gen_random_uuid(), '/dashboard/projetos/permutas/[id]', 'hub', 'Permuta — extrato', 'pronto', 'media', 'hub_projetos', true,
  ARRAY['fn_permuta_extrato','fn_permuta_movimento_add','fn_permuta_movimento_excluir']::text[],
  ARRAY['hub_permuta','hub_permuta_movimento','hub_indice_valor','companies']::text[],
  now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens WHERE rota = '/dashboard/projetos/permutas/[id]');

-- ───────────────────────────── 7) RD-95: ajuda "?" ─────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('permuta.lista.a_receber', '/dashboard/projetos/permutas', 'Permutas', 'hub_projetos', 10, 'A receber em permuta',
   'Soma do valor atualizado (contrato + reajuste do índice) de todas as permutas abertas no filtro atual.',
   'Mostra quanto ainda está representado em permutas — o imóvel que a empresa tem a receber em obra, serviço, material ou dinheiro.',
   'R$ 1.200.000 em 3 permutas', 'Confundir com o saldo: "a receber" é o valor total do contrato, não o que falta quitar.'),
  ('permuta.lista.quitado', '/dashboard/projetos/permutas', 'Permutas', 'hub_projetos', 11, 'Quitado',
   'Soma de todos os movimentos lançados (dinheiro, obra, serviço, material, imóvel) que abateram as permutas do filtro.',
   'Mostra quanto das permutas já foi entregue/pago.', 'R$ 480.000 quitados', 'Esquecer de lançar uma medição do mês e achar que quitou menos do que realmente entregou.'),
  ('permuta.lista.saldo', '/dashboard/projetos/permutas', 'Permutas', 'hub_projetos', 12, 'Saldo',
   'Valor atualizado − quitado. Positivo = ainda deve; negativo (vermelho) = pagou a mais.',
   'É o que falta quitar da permuta. Negativo avisa que você já entregou mais do que o contrato previa.',
   'R$ 720.000 a quitar', 'Ignorar o saldo negativo: pagar a mais numa permuta é dinheiro que não volta sozinho.'),
  ('permuta.lista.abertas', '/dashboard/projetos/permutas', 'Permutas', 'hub_projetos', 13, 'Abertas',
   'Quantidade de permutas com saldo devedor (ainda não quitadas) no filtro atual.',
   'Conta quantos contratos de permuta ainda estão em aberto.', '3 abertas', 'Contar as quitadas junto e achar que há mais trabalho pendente do que há.'),
  ('permuta.lista.empresa', '/dashboard/projetos/permutas', 'Permutas', 'hub_projetos', 14, 'Empresa (CNPJ)',
   'Filtra por empresa do grupo. "Consolidado" soma todas, eliminando permuta marcada como intragrupo para não contar duas vezes.',
   'Permite ver cada CNPJ separado ou o grupo inteiro — útil quando as notas que quitam a permuta saem de várias empresas do grupo.',
   'Consolidado (3 empresas)', 'Somar manualmente os CNPJs sem tirar a permuta intragrupo e inflar o total.'),
  ('permuta.lista.status', '/dashboard/projetos/permutas', 'Permutas', 'hub_projetos', 15, 'Situação',
   'A iniciar (sem movimento), Saldo devedor (falta quitar), Quitado (zerado) ou Pagou a mais (saldo negativo).',
   'Diz, num olhar, em que pé está cada permuta.', 'Saldo devedor', 'Deixar uma permuta "a iniciar" por meses porque ninguém lançou a primeira medição.'),
  ('permuta.form.tipo_contrato', '/dashboard/projetos/permutas', 'Permutas', 'hub_projetos', 20, 'Tipo de contrato',
   '100% dinheiro, 100% permuta ou misto (parte em dinheiro, parte em permuta).',
   'Define como o imóvel é pago: só em obra/serviço/material, só em dinheiro, ou os dois.',
   'Misto: 60% permuta + 40% dinheiro', 'Marcar 100% permuta e ainda lançar o valor em dinheiro — os campos devem bater com o tipo.'),
  ('permuta.form.valor_permuta', '/dashboard/projetos/permutas', 'Permutas', 'hub_projetos', 21, 'Valor em permuta (R$)',
   'O valor do imóvel que será pago em obra, serviço, material ou imóvel (não em dinheiro).',
   'É a base do saldo: o quanto a empresa precisa entregar em permuta.', 'R$ 800.000', 'Lançar o valor total do imóvel aqui mesmo havendo parte em dinheiro.'),
  ('permuta.form.indice_reajuste', '/dashboard/projetos/permutas', 'Permutas', 'hub_projetos', 22, 'Índice de reajuste',
   'O índice que corrige o valor da permuta ao longo do tempo (ex.: CUB-SC). Deixe vazio se não houver reajuste.',
   'O saldo passa a usar o valor atualizado pelo índice desde o mês-base. Precisa da série do índice cadastrada.',
   'CUB-SC', 'Informar o índice sem o mês-base: sem os dois, o reajuste fica em zero.'),
  ('permuta.form.data_base', '/dashboard/projetos/permutas', 'Permutas', 'hub_projetos', 23, 'Mês-base do valor',
   'O mês a que se refere o valor do contrato — ponto de partida do reajuste pelo índice.',
   'O reajuste acumula do mês-base até hoje usando a série do índice.', '01/2026', 'Usar a data de assinatura em vez do mês de referência do valor.'),
  ('permuta.mov.tipo', '/dashboard/projetos/permutas/[id]', 'Permutas', 'hub_projetos', 30, 'Tipo do movimento',
   'Como a permuta foi quitada neste lançamento: dinheiro, obra, serviço, material ou imóvel.',
   'Classifica cada quitação — na F2, obra puxa medição, material baixa estoque e dinheiro liga um título a pagar.',
   'Serviço (medição de maio)', 'Lançar tudo como "dinheiro" e perder a origem da quitação.'),
  ('permuta.mov.competencia', '/dashboard/projetos/permutas/[id]', 'Permutas', 'hub_projetos', 31, 'Competência (mês)',
   'O mês a que o movimento se refere (medição mensal). O extrato agrupa por esse mês.',
   'Permite o fechamento mensal por obra e enviar ao cliente o extrato do mês.', '05/2026', 'Usar a data de pagamento no lugar do mês da medição e bagunçar o fechamento.'),
  ('permuta.mov.num_nota', '/dashboard/projetos/permutas/[id]', 'Permutas', 'hub_projetos', 32, 'Nota fiscal de origem',
   'Número da nota que comprova o movimento, com a empresa emissora (quando a quitação sai de outra empresa do grupo).',
   'Rastreia de qual CNPJ saiu cada quitação — no consolidado, a permuta é uma só, mas as notas vêm de várias empresas.',
   'NF 1234 — Gessos LTDA', 'Somar notas de empresas do grupo sem registrar de qual CNPJ saiu cada uma.'),
  ('permuta.extrato.valor_atualizado', '/dashboard/projetos/permutas/[id]', 'Permutas', 'hub_projetos', 33, 'Valor atualizado',
   'Valor do contrato + reajuste acumulado pelo índice (ex.: CUB) desde o mês-base.',
   'É sobre esse valor que o saldo é calculado — não sobre o valor nominal antigo.', 'R$ 800.000 + R$ 42.000 (CUB) = R$ 842.000',
   'Comparar o quitado com o valor nominal e achar que quitou mais do que quitou.'),
  ('permuta.lista.busca', '/dashboard/projetos/permutas', 'Permutas', 'hub_projetos', 16, 'Buscar',
   'Filtra a lista por contratante, imóvel/ativo ou nome da empresa.',
   'Acha rápido uma permuta específica sem rolar a lista toda.', 'Andrade', 'Buscar pelo número da nota — a busca é por contratante/imóvel, não por NF.'),
  ('permuta.form.contratante', '/dashboard/projetos/permutas', 'Permutas', 'hub_projetos', 24, 'Contratante',
   'Quem entrega o terreno/imóvel na permuta (a outra parte do contrato).',
   'Identifica a permuta na lista e no extrato.', 'Família Andrade (terreno Centro)', 'Deixar genérico ("cliente") e não saber depois de qual permuta se trata.'),
  ('permuta.form.ativo', '/dashboard/projetos/permutas', 'Permutas', 'hub_projetos', 25, 'Imóvel / ativo permutado',
   'O que será entregue em troca — a unidade, sala ou imóvel objeto da permuta.',
   'Deixa claro o que a empresa precisa entregar.', 'Apartamento 1201 — Torre A', 'Descrever vago demais e confundir com outra unidade.'),
  ('permuta.form.valor_dinheiro', '/dashboard/projetos/permutas', 'Permutas', 'hub_projetos', 26, 'Valor em dinheiro (R$)',
   'A parte do negócio paga em dinheiro (quando o contrato é misto). Zero quando é 100% permuta.',
   'Separa a parte em dinheiro da parte em permuta — só a permuta entra no saldo a quitar.', 'R$ 400.000', 'Somar o valor em dinheiro ao saldo da permuta e inflar o que falta entregar.'),
  ('permuta.form.intragrupo', '/dashboard/projetos/permutas', 'Permutas', 'hub_projetos', 27, 'Permuta intragrupo',
   'Marque quando a permuta é entre duas empresas do próprio grupo.',
   'No consolidado, a permuta marcada assim não entra nos totais, evitando contar o mesmo negócio duas vezes.',
   'Terreno de uma empresa do grupo para outra', 'Esquecer de marcar e dobrar o valor no consolidado do grupo.'),
  ('permuta.mov.valor', '/dashboard/projetos/permutas/[id]', 'Permutas', 'hub_projetos', 34, 'Valor (R$)',
   'Quanto este movimento abate da permuta.',
   'É o que entra no quitado e reduz o saldo.', 'R$ 120.000', 'Lançar o valor acumulado do ano todo numa linha só em vez de por competência.'),
  ('permuta.mov.data', '/dashboard/projetos/permutas/[id]', 'Permutas', 'hub_projetos', 35, 'Data',
   'A data do lançamento/pagamento deste movimento.',
   'Registra quando a quitação aconteceu.', '10/02/2026', 'Confundir com a competência: a data é do pagamento, a competência é o mês da medição.'),
  ('permuta.mov.cnpj_emissor', '/dashboard/projetos/permutas/[id]', 'Permutas', 'hub_projetos', 36, 'CNPJ emissor',
   'O CNPJ que emitiu a nota deste movimento, quando sai de outra empresa do grupo.',
   'Rastreia de qual empresa do grupo veio a quitação no consolidado multi-CNPJ.', '12.345.678/0001-90', 'Deixar em branco quando a nota é de outra empresa e perder a origem.'),
  ('permuta.mov.observacao', '/dashboard/projetos/permutas/[id]', 'Permutas', 'hub_projetos', 37, 'Observação',
   'Uma nota livre sobre o movimento (ex.: a que medição ou etapa se refere).',
   'Ajuda a entender o lançamento depois, no extrato.', 'Medição de maio — 2ª parcela', 'Repetir no texto o que já está nos outros campos em vez de explicar o contexto.')
ON CONFLICT (chave) DO NOTHING;

-- ───────────────────────────── 8) DEMO (RD-69 — construtora fictícia, nunca cliente real) ──────────────
-- Série CUB-SC fictícia (global) p/ o exemplo de reajuste; valores ilustrativos, não oficiais.
INSERT INTO public.hub_indice_valor (company_id, indice, competencia, valor)
VALUES
  (NULL, 'CUB-SC', '2026-01-01', 2850.000000),
  (NULL, 'CUB-SC', '2026-06-01', 2955.000000),
  (NULL, 'CUB-SC', '2026-11-01', 3012.000000)
ON CONFLICT DO NOTHING;

-- Permutas de exemplo na Construtora Modelo Demonstração (b0700000-...-006), só se ainda não houver nenhuma.
DO $demo$
DECLARE
  v_co uuid := 'b0700000-0000-4000-a000-000000000006';
  v_p1 uuid; v_p2 uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = v_co)
     AND NOT EXISTS (SELECT 1 FROM public.hub_permuta WHERE company_id = v_co) THEN
    INSERT INTO public.hub_permuta (company_id, contratante, ativo_descr, tipo_contrato, pct_permuta,
      valor_permuta, valor_dinheiro, indice_reajuste, data_base, observacao)
    VALUES (v_co, 'Família Andrade (terreno Centro)', 'Apartamento 1201 — Torre A', 'misto', 60,
      800000, 400000, 'CUB-SC', '2026-01-01', 'Permuta de demonstração — valores fictícios (RD-69).')
    RETURNING id INTO v_p1;
    INSERT INTO public.hub_permuta (company_id, contratante, ativo_descr, tipo_contrato,
      valor_permuta, valor_dinheiro, observacao)
    VALUES (v_co, 'Imobiliária Horizonte', 'Sala comercial 302', '100_permuta',
      300000, 0, 'Permuta de demonstração — valores fictícios (RD-69).')
    RETURNING id INTO v_p2;
    -- movimentos (medição mensal + nota fiscal fictícia)
    INSERT INTO public.hub_permuta_movimento (permuta_id, company_id, tipo, valor, data, competencia, num_nota, cnpj_emissor, empresa_emissora_id, observacao)
    VALUES
      (v_p1, v_co, 'servico', 120000, '2026-02-10', '2026-01-01', 'NF 1001', NULL, v_co, 'Medição jan/26'),
      (v_p1, v_co, 'material', 60000, '2026-03-12', '2026-02-01', 'NF 1002', NULL, v_co, 'Material fev/26'),
      (v_p2, v_co, 'obra', 300000, '2026-04-20', '2026-03-01', 'NF 1003', NULL, v_co, 'Entrega total — quitado');
  END IF;
END
$demo$;
