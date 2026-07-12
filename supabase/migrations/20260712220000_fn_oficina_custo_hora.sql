-- ============================================================
-- TEMPÁRIO · PASSO 2 — fn_oficina_custo_hora (o diferencial-âncora).
--
-- Calcula o CUSTO HOMEM-HORA REAL da oficina, automático, dos custos fixos que
-- JÁ estão em GE (erp_pagar), pelas categorias configuradas em
-- erp_oficina_parametros.categorias_custo_fixo. Ninguém no BR faz isso — os
-- concorrentes pedem pro dono CHUTAR. A PS CALCULA.
--
-- FÓRMULA: custo_hora = Σ custos fixos do período ÷ (horas_produtivas_mes × N meses)
--   • média de N meses (default 3) — não oscila com sazonalidade.
--   • competência: status IN ('pago','aberto','vencido').
--
-- ⚠️ ARQUITETURA: LÊ erp_pagar (GE). NÃO cria tela financeira na oficina.
-- 🛡️ GUARDAS (RD-38): sem custos → NULL + orientação (NUNCA 0, que geraria preço 0);
--    horas 0 → erro; override manual respeitado (mostra o calculado ao lado);
--    valor atípico (<10 ou >1000/h) → retorna com alerta; guarda de tenant.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_oficina_custo_hora(p_company_id uuid, p_periodo_meses int DEFAULT 3)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_meses int := GREATEST(1, LEAST(24, COALESCE(p_periodo_meses, 3)));
  v_cats text[];
  v_horas_mes numeric;
  v_manual numeric;
  v_margem_mo numeric;
  v_margem_peca numeric;
  v_inicio date;
  v_fim date;
  v_horas_total numeric;
  v_total numeric;
  v_detalhe jsonb;
  v_custo numeric;
  v_origem text;
  v_alerta text := NULL;
  v_periodo text;
BEGIN
  -- guarda de tenant
  IF p_company_id IS NULL OR (p_company_id NOT IN (SELECT get_user_company_ids()) AND NOT is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;

  SELECT
    COALESCE(categorias_custo_fixo, ARRAY['2.04.01','2.03.01','2.03.10','2.04.04','2.04.10','2.05.04']::text[]),
    COALESCE(horas_produtivas_mes, 160),
    custo_hora_manual, COALESCE(margem_alvo_mao_obra_pct, 30), COALESCE(margem_alvo_peca_pct, 40)
  INTO v_cats, v_horas_mes, v_manual, v_margem_mo, v_margem_peca
  FROM erp_oficina_parametros WHERE company_id = p_company_id;

  IF v_horas_mes IS NULL THEN  -- sem linha de parâmetros → defaults
    v_cats := ARRAY['2.04.01','2.03.01','2.03.10','2.04.04','2.04.10','2.05.04']::text[];
    v_horas_mes := 160; v_margem_mo := 30; v_margem_peca := 40;
  END IF;

  IF COALESCE(v_horas_mes, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'custo_hora', NULL, 'origem', 'erro',
      'alerta', 'Horas produtivas por mês inválidas (0). Ajuste em parâmetros.');
  END IF;

  v_inicio := (date_trunc('month', CURRENT_DATE) - make_interval(months => v_meses - 1))::date;
  v_fim := (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date;
  v_horas_total := v_horas_mes * v_meses;
  v_periodo := to_char(v_inicio, 'MM/YYYY') || '–' || to_char(v_fim, 'MM/YYYY') || ' (' || v_meses || ' meses)';

  WITH base AS (
    SELECT ep.categoria, SUM(ep.valor) AS valor
    FROM erp_pagar ep
    WHERE ep.company_id = p_company_id
      AND ep.categoria = ANY(v_cats)
      AND COALESCE(ep.data_competencia, ep.data_vencimento, ep.data_emissao) BETWEEN v_inicio AND v_fim
      AND (ep.status IS NULL OR ep.status IN ('pago','aberto','vencido'))
    GROUP BY ep.categoria
  )
  SELECT
    COALESCE(SUM(b.valor), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'categoria', b.categoria,
      'rotulo', COALESCE(pc.descricao, b.categoria),
      'valor', ROUND(b.valor, 2)
    ) ORDER BY b.valor DESC), '[]'::jsonb)
  INTO v_total, v_detalhe
  FROM base b
  LEFT JOIN erp_plano_contas pc ON pc.company_id = p_company_id AND pc.codigo = b.categoria;

  -- adiciona o % de cada categoria (transparência)
  IF v_total > 0 THEN
    SELECT jsonb_agg(elem || jsonb_build_object('pct', ROUND((elem->>'valor')::numeric / v_total * 100, 1)))
    INTO v_detalhe FROM jsonb_array_elements(v_detalhe) elem;
  END IF;

  -- 🛡️ GUARDA custo zero: NUNCA retornar 0
  IF v_total <= 0 THEN
    IF v_manual IS NOT NULL AND v_manual > 0 THEN
      RETURN jsonb_build_object('ok', true, 'custo_hora', v_manual, 'custo_hora_calculado', NULL,
        'origem', 'manual', 'periodo', v_periodo, 'total_custos_fixos', 0,
        'horas_consideradas', v_horas_total, 'horas_produtivas_mes', v_horas_mes,
        'margem_mao_obra_pct', v_margem_mo, 'margem_peca_pct', v_margem_peca, 'detalhe', '[]'::jsonb,
        'alerta', 'Sem custos lançados no período — usando o valor manual que você definiu.');
    END IF;
    RETURN jsonb_build_object('ok', true, 'custo_hora', NULL, 'custo_hora_calculado', NULL,
      'origem', 'sem_dados', 'periodo', v_periodo, 'total_custos_fixos', 0,
      'horas_consideradas', v_horas_total, 'horas_produtivas_mes', v_horas_mes,
      'margem_mao_obra_pct', v_margem_mo, 'margem_peca_pct', v_margem_peca, 'detalhe', '[]'::jsonb,
      'alerta', 'Sem custos lançados no período. Lance as despesas em Gestão Empresarial → Financeiro, ou informe um valor manual.');
  END IF;

  v_custo := ROUND(v_total / v_horas_total, 2);

  IF v_manual IS NOT NULL AND v_manual > 0 THEN
    v_origem := 'manual';
  ELSE
    v_origem := 'calculado';
    IF v_custo < 10 OR v_custo > 1000 THEN
      v_alerta := 'Valor atípico — confira as horas produtivas e as categorias de custo.';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'custo_hora', CASE WHEN v_origem = 'manual' THEN v_manual ELSE v_custo END,
    'custo_hora_calculado', v_custo,
    'origem', v_origem,
    'periodo', v_periodo,
    'total_custos_fixos', ROUND(v_total, 2),
    'horas_consideradas', v_horas_total,
    'horas_produtivas_mes', v_horas_mes,
    'margem_mao_obra_pct', v_margem_mo,
    'margem_peca_pct', v_margem_peca,
    'detalhe', v_detalhe,
    'alerta', v_alerta
  );
END; $function$;

GRANT EXECUTE ON FUNCTION public.fn_oficina_custo_hora(uuid, int) TO authenticated;
