-- ============================================================
-- Fiscal · Lei 12.741 (Simples) · percentual por COMPETÊNCIA (a alíquota efetiva muda todo mês)
-- ============================================================
-- A alíquota efetiva do Simples depende do RBT12 → VARIA a cada mês. O campo único
-- erp_fiscal_provider_config.percentual_total_tributos_sn é armadilha: a nota de outubro sairia com
-- a % de agosto e ninguém veria. A contabilidade envia o percentual mês a mês.
--
-- Correção (CEO): HISTÓRICO por competência. A nota usa o percentual da COMPETÊNCIA dela. Alerta
-- quando o mais recente estiver velho ("alíquota de julho — a contabilidade já enviou a de setembro?").
-- Genérico por company_id (empresa é validador, nunca destinatário). Migra o valor atual como
-- competência inicial (não apaga o campo — fica de fallback/legado).

CREATE TABLE IF NOT EXISTS public.erp_fiscal_percentual_sn (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  competencia   date NOT NULL,                 -- 1º dia do mês de referência
  percentual    numeric NOT NULL,
  fonte         text NOT NULL DEFAULT 'contabilidade',
  observacao    text,
  informado_por uuid,
  informado_em  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, competencia)
);
CREATE INDEX IF NOT EXISTS ix_fiscal_pct_sn ON public.erp_fiscal_percentual_sn (company_id, competencia DESC);
ALTER TABLE public.erp_fiscal_percentual_sn ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fiscal_pct_sn_rls ON public.erp_fiscal_percentual_sn;
CREATE POLICY fiscal_pct_sn_rls ON public.erp_fiscal_percentual_sn FOR ALL TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());

-- backfill: o valor atual do campo único vira a competência do mês corrente (NÃO apaga o campo)
INSERT INTO public.erp_fiscal_percentual_sn (company_id, competencia, percentual, fonte, observacao)
SELECT fpc.company_id, date_trunc('month', current_date)::date, fpc.percentual_total_tributos_sn,
       'migracao_campo_unico', 'Migrado do campo único na criação do histórico por competência'
FROM public.erp_fiscal_provider_config fpc
WHERE fpc.percentual_total_tributos_sn IS NOT NULL AND fpc.percentual_total_tributos_sn > 0
ON CONFLICT (company_id, competencia) DO NOTHING;

-- DEFINIR o percentual de uma competência (upsert). Fonte 'contabilidade' por padrão.
CREATE OR REPLACE FUNCTION public.fn_fiscal_percentual_sn_definir(p_company_id uuid, p_competencia date, p_percentual numeric, p_fonte text DEFAULT 'contabilidade', p_observacao text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_comp date := date_trunc('month', p_competencia)::date;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_percentual IS NULL OR p_percentual < 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'percentual_invalido'); END IF;
  INSERT INTO public.erp_fiscal_percentual_sn (company_id, competencia, percentual, fonte, observacao, informado_por)
  VALUES (p_company_id, v_comp, p_percentual, COALESCE(NULLIF(trim(p_fonte),''),'contabilidade'), p_observacao, auth.uid())
  ON CONFLICT (company_id, competencia) DO UPDATE SET percentual=EXCLUDED.percentual, fonte=EXCLUDED.fonte, observacao=EXCLUDED.observacao, informado_por=auth.uid(), informado_em=now();
  RETURN jsonb_build_object('ok', true, 'competencia', v_comp, 'percentual', p_percentual);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_percentual_sn_definir(uuid, date, numeric, text, text) TO authenticated;

-- VIGENTE na competência da nota: a linha da competência, ou a mais recente ANTERIOR a ela
-- (a alíquota vale até a contabilidade enviar a próxima). Fallback: campo único legado.
CREATE OR REPLACE FUNCTION public.fn_fiscal_percentual_sn_vigente(p_company_id uuid, p_data date DEFAULT current_date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_comp date := date_trunc('month', p_data)::date; v_r record; v_legado numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT percentual, competencia, fonte INTO v_r FROM public.erp_fiscal_percentual_sn
   WHERE company_id=p_company_id AND competencia <= v_comp ORDER BY competencia DESC LIMIT 1;
  IF v_r.percentual IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'percentual', v_r.percentual, 'competencia', v_r.competencia, 'fonte', v_r.fonte,
      'defasada', (v_r.competencia < v_comp), 'origem', 'historico');
  END IF;
  SELECT percentual_total_tributos_sn INTO v_legado FROM public.erp_fiscal_provider_config WHERE company_id=p_company_id;
  IF v_legado IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'percentual', v_legado, 'competencia', NULL, 'fonte', 'campo_unico_legado', 'defasada', false, 'origem', 'legado'); END IF;
  RETURN jsonb_build_object('ok', false, 'erro', 'sem_percentual');
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_percentual_sn_vigente(uuid, date) TO authenticated;

-- STATUS p/ o alerta: mostra a competência do mais recente e se está velha (mês corrente sem envio)
CREATE OR REPLACE FUNCTION public.fn_fiscal_percentual_sn_status(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_r record; v_atual date := date_trunc('month', current_date)::date; v_meses text[] := ARRAY['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT percentual, competencia, fonte INTO v_r FROM public.erp_fiscal_percentual_sn
   WHERE company_id=p_company_id ORDER BY competencia DESC LIMIT 1;
  IF v_r.competencia IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'tem', false, 'nivel', 'sem_percentual', 'mensagem', 'Nenhum percentual do Simples cadastrado. Peça o valor à contabilidade e informe a competência.'); END IF;
  RETURN jsonb_build_object('ok', true, 'tem', true, 'percentual', v_r.percentual, 'competencia', v_r.competencia,
    'defasada', (v_r.competencia < v_atual),
    'nivel', CASE WHEN v_r.competencia < v_atual THEN 'defasada' ELSE 'ok' END,
    'mensagem', CASE WHEN v_r.competencia < v_atual
      THEN 'A alíquota cadastrada é de '||v_meses[extract(month from v_r.competencia)::int]||'/'||extract(year from v_r.competencia)::int
           ||' — a contabilidade já enviou a de '||v_meses[extract(month from v_atual)::int]||'?'
      ELSE 'Alíquota de '||v_meses[extract(month from v_r.competencia)::int]||'/'||extract(year from v_r.competencia)::int||' cadastrada.' END);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_percentual_sn_status(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_fiscal_percentual_sn_listar(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  RETURN jsonb_build_object('ok', true, 'linhas', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('competencia', competencia, 'percentual', percentual, 'fonte', fonte, 'informado_em', informado_em) ORDER BY competencia DESC)
    FROM public.erp_fiscal_percentual_sn WHERE company_id=p_company_id), '[]'::jsonb));
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_percentual_sn_listar(uuid) TO authenticated;
