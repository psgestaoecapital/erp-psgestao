-- R8b · Anúncio + custo de mídia por portal → custo por venda por origem (Revenda / Onda 8).
-- 1) anúncio por veículo: texto editável (gerado da ficha no cliente) guardado em veic_veiculo.anuncio_texto.
-- 2) origem do lead na negociação (qual portal trouxe o cliente) — base do "custo por venda por origem".
-- 3) ledger de custo de mídia por portal/mês (lançado à mão) + custo por venda por origem no período.
-- Genérico: nenhum portal fixo no código; tudo texto livre. Autoria por auth.uid(); SECURITY DEFINER sem anon.

-- ── 1) anúncio por veículo ──────────────────────────────────────────────────
ALTER TABLE public.veic_veiculo
  ADD COLUMN IF NOT EXISTS anuncio_texto text,
  ADD COLUMN IF NOT EXISTS anuncio_atualizado_em timestamptz,
  ADD COLUMN IF NOT EXISTS anuncio_atualizado_por uuid;

-- ── 2) origem do lead na negociação (qual portal/fonte trouxe o cliente) ─────
ALTER TABLE public.veic_negociacao
  ADD COLUMN IF NOT EXISTS origem_lead text;

-- ── 3) ledger de custo de mídia por portal/mês ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.veic_anuncio_custo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  portal text NOT NULL,
  competencia date NOT NULL,          -- 1º dia do mês de referência
  custo_total numeric NOT NULL DEFAULT 0,
  leads integer,                      -- opcional: nº de leads do portal no mês
  observacao text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, portal, competencia)
);
ALTER TABLE public.veic_anuncio_custo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS veic_anuncio_custo_rw ON public.veic_anuncio_custo;
CREATE POLICY veic_anuncio_custo_rw ON public.veic_anuncio_custo
  FOR ALL USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- ── fn · salvar o texto do anúncio (autoria por auth.uid) ───────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_anuncio_salvar(p_veiculo_id uuid, p_texto text, p_user uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_autor uuid := auth.uid();
BEGIN
  v_company := public.fn_veic_acesso(p_veiculo_id);
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE veic_veiculo
     SET anuncio_texto = NULLIF(btrim(p_texto), ''), anuncio_atualizado_em = now(), anuncio_atualizado_por = v_autor,
         updated_at = now(), updated_by = v_autor
   WHERE id = p_veiculo_id;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- ── fn · upsert do custo de mídia por portal/mês ────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_anuncio_custo_salvar(
  p_company_id uuid, p_portal text, p_competencia date, p_custo numeric, p_leads integer DEFAULT NULL,
  p_observacao text DEFAULT NULL, p_user uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_autor uuid := auth.uid(); v_portal text := NULLIF(btrim(p_portal),''); v_comp date := date_trunc('month', p_competencia)::date;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_portal IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'portal_obrigatorio'); END IF;
  IF p_competencia IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'competencia_obrigatoria'); END IF;
  INSERT INTO veic_anuncio_custo (company_id, portal, competencia, custo_total, leads, observacao, created_by)
  VALUES (p_company_id, v_portal, v_comp, GREATEST(COALESCE(p_custo,0),0), NULLIF(GREATEST(COALESCE(p_leads,0),0),0), NULLIF(btrim(p_observacao),''), v_autor)
  ON CONFLICT (company_id, portal, competencia) DO UPDATE SET
    custo_total = GREATEST(COALESCE(p_custo,0),0),
    leads = NULLIF(GREATEST(COALESCE(p_leads,0),0),0),
    observacao = NULLIF(btrim(p_observacao),''),
    updated_at = now();
  RETURN jsonb_build_object('ok', true);
END $function$;

-- ── fn · listar custos de mídia (com custo por lead derivado) ───────────────
CREATE OR REPLACE FUNCTION public.fn_veic_anuncio_custo_listar(p_company_id uuid, p_de date DEFAULT NULL, p_ate date DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_rows jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.competencia DESC, t.portal), '[]'::jsonb) INTO v_rows FROM (
    SELECT id, portal, competencia, custo_total, leads,
           CASE WHEN COALESCE(leads,0) > 0 THEN round(custo_total/leads, 2) END AS custo_por_lead, observacao
    FROM veic_anuncio_custo
    WHERE company_id = p_company_id
      AND (p_de IS NULL OR competencia >= date_trunc('month', p_de)::date)
      AND (p_ate IS NULL OR competencia <= date_trunc('month', p_ate)::date)
  ) t;
  RETURN jsonb_build_object('ok', true, 'itens', v_rows);
END $function$;

-- ── fn · custo por venda por origem (leads no período ÷ vendas atribuídas) ───
CREATE OR REPLACE FUNCTION public.fn_veic_custo_por_venda_origem(p_company_id uuid, p_de date, p_ate date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_rows jsonb; v_vendas_total int; v_custo_total numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- vendas no período, com a origem do lead da negociação vencedora (venda_id) — sem origem → "não informado"
  WITH vendas AS (
    SELECT v.id, COALESCE(NULLIF(btrim(n.origem_lead),''), 'não informado') AS origem
    FROM veic_venda v
    LEFT JOIN veic_negociacao n ON n.venda_id = v.id
    WHERE v.company_id = p_company_id AND v.deleted_at IS NULL AND v.devolvido_em IS NULL
      AND v.data_venda BETWEEN p_de AND p_ate
  ),
  vendas_por_origem AS (
    SELECT origem, count(*) AS vendas FROM vendas GROUP BY origem
  ),
  -- custo de mídia por portal no período (competência dentro do intervalo)
  custo_por_portal AS (
    SELECT portal AS origem, sum(custo_total) AS custo, sum(COALESCE(leads,0)) AS leads
    FROM veic_anuncio_custo
    WHERE company_id = p_company_id
      AND competencia >= date_trunc('month', p_de)::date AND competencia <= date_trunc('month', p_ate)::date
    GROUP BY portal
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.origem), '[]'::jsonb) INTO v_rows FROM (
    SELECT COALESCE(c.origem, s.origem) AS origem,
           COALESCE(c.custo, 0) AS custo_midia,
           COALESCE(c.leads, 0) AS leads,
           COALESCE(s.vendas, 0) AS vendas,
           CASE WHEN COALESCE(s.vendas,0) > 0 AND COALESCE(c.custo,0) > 0 THEN round(c.custo / s.vendas, 2) END AS custo_por_venda
    FROM custo_por_portal c
    FULL OUTER JOIN vendas_por_origem s ON s.origem = c.origem
  ) t;

  SELECT count(*) INTO v_vendas_total FROM veic_venda v
    WHERE v.company_id = p_company_id AND v.deleted_at IS NULL AND v.devolvido_em IS NULL AND v.data_venda BETWEEN p_de AND p_ate;
  SELECT COALESCE(sum(custo_total),0) INTO v_custo_total FROM veic_anuncio_custo
    WHERE company_id = p_company_id AND competencia >= date_trunc('month', p_de)::date AND competencia <= date_trunc('month', p_ate)::date;

  RETURN jsonb_build_object('ok', true, 'por_origem', v_rows,
    'vendas_total', v_vendas_total, 'custo_midia_total', v_custo_total,
    'custo_por_venda_geral', CASE WHEN v_vendas_total > 0 AND v_custo_total > 0 THEN round(v_custo_total/v_vendas_total, 2) END);
END $function$;

-- ── grants (CEO: SECURITY DEFINER sem anon) ─────────────────────────────────
REVOKE ALL ON FUNCTION public.fn_veic_anuncio_salvar(uuid,text,uuid)                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_anuncio_custo_salvar(uuid,text,date,numeric,integer,text,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_anuncio_custo_listar(uuid,date,date)                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_custo_por_venda_origem(uuid,date,date)               FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_anuncio_salvar(uuid,text,uuid)                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_anuncio_custo_salvar(uuid,text,date,numeric,integer,text,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_anuncio_custo_listar(uuid,date,date)                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_custo_por_venda_origem(uuid,date,date)              TO authenticated, service_role;
