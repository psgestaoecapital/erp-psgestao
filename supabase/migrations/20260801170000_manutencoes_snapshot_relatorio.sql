-- RD-41 · SPEC B — Histórico de Manutenções com custo/peças/lucro. Financeiro/gerencial
-- (domínio GE): consome a OS operacional da Oficina, custo da peça vem do PRODUTO de GE.
-- Snapshot congela o lucro na entrega (custo médio muda com o tempo). Aditivo (RD).

-- Snapshots aditivos na OS (congelam na entrega; base do BI futuro).
ALTER TABLE public.erp_os
  ADD COLUMN IF NOT EXISTS custo_pecas_snapshot    numeric,
  ADD COLUMN IF NOT EXISTS custo_mao_obra_snapshot numeric,
  ADD COLUMN IF NOT EXISTS receita_snapshot        numeric,
  ADD COLUMN IF NOT EXISTS lucro_snapshot          numeric,
  ADD COLUMN IF NOT EXISTS margem_snapshot         numeric,
  ADD COLUMN IF NOT EXISTS snapshot_em             timestamptz,
  ADD COLUMN IF NOT EXISTS snapshot_estimado       boolean NOT NULL DEFAULT false;

-- Calcula e grava o snapshot de custo/lucro de uma OS. Custo peça [→GE] = custo do
-- produto de GE × qtd (peças aprovadas/compradas/trocadas). Mão de obra = horas
-- apontadas × custo-hora (fn_oficina_custo_hora). p_estimado marca dado aproximado.
CREATE OR REPLACE FUNCTION public.fn_os_snapshot_custo_lucro(p_os_id uuid, p_estimado boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_receita numeric; v_pecas numeric; v_horas numeric;
  v_ch jsonb; v_custo_hora numeric; v_mo numeric; v_lucro numeric; v_margem numeric; v_est boolean;
BEGIN
  SELECT company_id, COALESCE(total, 0) INTO v_comp, v_receita FROM erp_os WHERE id = p_os_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada'); END IF;

  -- Custo das peças [→GE] (custo do produto de GE × quantidade)
  SELECT COALESCE(SUM(COALESCE(pr.preco_custo_medio, pr.preco_custo, 0) * COALESCE(s.quantidade, 1)), 0)
    INTO v_pecas
  FROM erp_os_peca_solicitacao s
  LEFT JOIN erp_produtos pr ON pr.id = s.produto_id
  WHERE s.os_id = p_os_id AND s.status IN ('aprovado','comprado','trocada');

  -- Horas apontadas (real, senão estimado)
  SELECT COALESCE(SUM(COALESCE(tempo_real_h, tempo_estimado_h, 0)), 0)
    INTO v_horas FROM erp_os_apontamento WHERE os_id = p_os_id;

  -- Custo-hora (reusa fn_oficina_custo_hora). Se indisponível → mão de obra 0 + estimado.
  v_ch := public.fn_oficina_custo_hora(v_comp, 3);
  IF COALESCE((v_ch->>'ok')::boolean, false) AND NULLIF(v_ch->>'custo_hora', '') IS NOT NULL THEN
    v_custo_hora := (v_ch->>'custo_hora')::numeric;
  ELSE
    v_custo_hora := NULL;
  END IF;

  v_mo := COALESCE(v_horas, 0) * COALESCE(v_custo_hora, 0);
  v_lucro := v_receita - (v_pecas + v_mo);
  v_margem := CASE WHEN v_receita > 0 THEN ROUND(v_lucro / v_receita * 100, 1) ELSE NULL END;
  v_est := p_estimado OR v_custo_hora IS NULL;

  UPDATE erp_os SET
    custo_pecas_snapshot    = ROUND(v_pecas, 2),
    custo_mao_obra_snapshot = ROUND(v_mo, 2),
    receita_snapshot        = ROUND(v_receita, 2),
    lucro_snapshot          = ROUND(v_lucro, 2),
    margem_snapshot         = v_margem,
    snapshot_em             = now(),
    snapshot_estimado       = v_est
  WHERE id = p_os_id;

  RETURN jsonb_build_object('ok', true, 'receita', ROUND(v_receita, 2), 'custo_pecas', ROUND(v_pecas, 2),
    'custo_mao_obra', ROUND(v_mo, 2), 'horas', v_horas, 'custo_hora', v_custo_hora,
    'lucro', ROUND(v_lucro, 2), 'margem', v_margem, 'estimado', v_est);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_os_snapshot_custo_lucro(uuid, boolean) TO authenticated;

-- Dispara o snapshot ao entrar em 'entregue' (junto do entregue_em do SPEC A).
-- AFTER UPDATE OF status → a fn atualiza colunas ≠ status, então não re-dispara (sem recursão).
CREATE OR REPLACE FUNCTION public.fn_os_snapshot_on_entrega()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn_os_snapshot_custo_lucro(NEW.id, false);
  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS trg_os_snapshot_entrega ON public.erp_os;
CREATE TRIGGER trg_os_snapshot_entrega
  AFTER INSERT OR UPDATE OF status ON public.erp_os
  FOR EACH ROW WHEN (NEW.status = 'entregue')
  EXECUTE FUNCTION public.fn_os_snapshot_on_entrega();

-- Relatório de manutenções (entregues) por company_id, com filtros e totais.
CREATE OR REPLACE FUNCTION public.fn_manutencoes_relatorio(
  p_company_id uuid, p_cliente_id uuid DEFAULT NULL, p_data_ini date DEFAULT NULL,
  p_data_fim date DEFAULT NULL, p_placa text DEFAULT NULL, p_mecanico text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_res jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  WITH os AS (
    SELECT o.id, o.numero, o.entregue_em, o.cliente_nome, o.cliente_id, o.placa,
           COALESCE(o.marca,'') || CASE WHEN o.modelo IS NOT NULL THEN ' ' || o.modelo ELSE '' END AS veiculo,
           o.tecnico_nome,
           COALESCE(o.receita_snapshot, o.total, 0) AS receita,
           o.custo_pecas_snapshot AS custo_pecas, o.custo_mao_obra_snapshot AS custo_mo,
           o.lucro_snapshot AS lucro, o.margem_snapshot AS margem,
           (o.snapshot_em IS NOT NULL) AS tem_snapshot, o.snapshot_estimado AS estimado
    FROM erp_os o
    WHERE o.company_id = p_company_id AND o.status = 'entregue'
      AND (p_cliente_id IS NULL OR o.cliente_id = p_cliente_id)
      AND (p_data_ini IS NULL OR o.entregue_em::date >= p_data_ini)
      AND (p_data_fim IS NULL OR o.entregue_em::date <= p_data_fim)
      AND (p_placa IS NULL OR o.placa ILIKE '%' || p_placa || '%')
      AND (p_mecanico IS NULL OR o.tecnico_nome ILIKE '%' || p_mecanico || '%')
  )
  SELECT jsonb_build_object(
    'ok', true,
    'linhas', COALESCE((SELECT jsonb_agg(to_jsonb(os) ORDER BY os.entregue_em DESC NULLS LAST) FROM os), '[]'::jsonb),
    'totais', (SELECT jsonb_build_object(
        'qtd', COUNT(*),
        'receita', COALESCE(SUM(receita), 0),
        'custo_pecas', COALESCE(SUM(custo_pecas), 0),
        'custo_mo', COALESCE(SUM(custo_mo), 0),
        'lucro', COALESCE(SUM(lucro), 0),
        'ticket_medio', CASE WHEN COUNT(*) > 0 THEN ROUND(SUM(receita) / COUNT(*), 2) ELSE 0 END,
        'margem_media', CASE WHEN SUM(receita) > 0 THEN ROUND(SUM(lucro) / SUM(receita) * 100, 1) ELSE NULL END,
        'estimadas', COUNT(*) FILTER (WHERE estimado OR NOT tem_snapshot)
      ) FROM os)
  ) INTO v_res;
  RETURN v_res;
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_manutencoes_relatorio(uuid,uuid,date,date,text,text) TO authenticated;

-- Drill de uma OS: peças (produto + qtd + custo unit [→GE]) + mão de obra (horas × custo-hora).
CREATE OR REPLACE FUNCTION public.fn_manutencao_detalhe(p_company_id uuid, p_os_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_pecas jsonb; v_horas numeric; v_ch jsonb; v_custo_hora numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'descricao', s.descricao, 'quantidade', s.quantidade, 'status', s.status,
      'custo_unit', COALESCE(pr.preco_custo_medio, pr.preco_custo, 0),
      'custo_total', ROUND(COALESCE(pr.preco_custo_medio, pr.preco_custo, 0) * COALESCE(s.quantidade,1), 2)
    ) ORDER BY s.solicitado_em), '[]'::jsonb)
    INTO v_pecas
  FROM erp_os_peca_solicitacao s LEFT JOIN erp_produtos pr ON pr.id = s.produto_id
  WHERE s.os_id = p_os_id AND s.company_id = p_company_id AND s.status IN ('aprovado','comprado','trocada');

  SELECT COALESCE(SUM(COALESCE(tempo_real_h, tempo_estimado_h, 0)), 0) INTO v_horas
  FROM erp_os_apontamento WHERE os_id = p_os_id;

  v_ch := public.fn_oficina_custo_hora(p_company_id, 3);
  v_custo_hora := CASE WHEN COALESCE((v_ch->>'ok')::boolean,false) THEN NULLIF(v_ch->>'custo_hora','')::numeric ELSE NULL END;

  RETURN jsonb_build_object('ok', true,
    'pecas', v_pecas,
    'mao_obra', jsonb_build_object('horas', v_horas, 'custo_hora', v_custo_hora,
      'custo', ROUND(v_horas * COALESCE(v_custo_hora,0), 2)));
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_manutencao_detalhe(uuid,uuid) TO authenticated;
