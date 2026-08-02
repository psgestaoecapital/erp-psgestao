-- RD-41 · PR-FIX #836 — receita/lucro HONESTOS. Decisão CEO 🅱️: a OS ainda não gera
-- faturamento (será o 🅰️, após GE validado). Então parar de derivar lucro do os_total
-- (inconsistente/0 = mentira). Receita = faturamento REAL de GE [→GE] via vínculo
-- canônico erp_receber.ref_externa_sistema='os'. Vazio → "aguardando faturamento"
-- (NULL), nunca 0/os_total. Custo (peças [→GE] + mão de obra) continua REAL. RD-51/38.

-- Snapshot: receita do vínculo canônico; lucro/margem NULL quando não há receita.
CREATE OR REPLACE FUNCTION public.fn_os_snapshot_custo_lucro(p_os_id uuid, p_estimado boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_receita numeric; v_pecas numeric; v_horas numeric;
  v_ch jsonb; v_custo_hora numeric; v_mo numeric; v_lucro numeric; v_margem numeric;
BEGIN
  SELECT company_id INTO v_comp FROM erp_os WHERE id = p_os_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada'); END IF;

  -- Receita = faturamento real de GE vinculado à OS (canônico). NULL se não há vínculo.
  SELECT SUM(r.valor) INTO v_receita FROM erp_receber r
   WHERE r.company_id = v_comp AND r.ref_externa_sistema = 'os'
     AND r.ref_externa_id = p_os_id::text AND r.deleted_at IS NULL;

  -- Custo das peças [→GE] (custo do produto de GE × quantidade) — REAL.
  SELECT COALESCE(SUM(COALESCE(pr.preco_custo_medio, pr.preco_custo, 0) * COALESCE(s.quantidade, 1)), 0)
    INTO v_pecas
  FROM erp_os_peca_solicitacao s
  LEFT JOIN erp_produtos pr ON pr.id = s.produto_id
  WHERE s.os_id = p_os_id AND s.status IN ('aprovado','comprado','trocada');

  -- Mão de obra = horas apontadas × custo-hora — REAL (mostra mesmo sem receita).
  SELECT COALESCE(SUM(COALESCE(tempo_real_h, tempo_estimado_h, 0)), 0)
    INTO v_horas FROM erp_os_apontamento WHERE os_id = p_os_id;
  v_ch := public.fn_oficina_custo_hora(v_comp, 3);
  IF COALESCE((v_ch->>'ok')::boolean, false) AND NULLIF(v_ch->>'custo_hora', '') IS NOT NULL THEN
    v_custo_hora := (v_ch->>'custo_hora')::numeric;
  END IF;
  v_mo := COALESCE(v_horas, 0) * COALESCE(v_custo_hora, 0);

  -- Lucro/margem SÓ quando há receita (não fingir 0).
  IF v_receita IS NULL THEN
    v_lucro := NULL; v_margem := NULL;
  ELSE
    v_lucro := v_receita - (v_pecas + v_mo);
    v_margem := CASE WHEN v_receita > 0 THEN ROUND(v_lucro / v_receita * 100, 1) ELSE NULL END;
  END IF;

  UPDATE erp_os SET
    custo_pecas_snapshot    = ROUND(v_pecas, 2),
    custo_mao_obra_snapshot = ROUND(v_mo, 2),
    receita_snapshot        = ROUND(v_receita, 2),   -- NULL preservado
    lucro_snapshot          = ROUND(v_lucro, 2),
    margem_snapshot         = v_margem,
    snapshot_em             = now(),
    snapshot_estimado       = false                   -- receita canônica + custo real: não é "estimado"
  WHERE id = p_os_id;

  RETURN jsonb_build_object('ok', true, 'receita', v_receita, 'custo_pecas', ROUND(v_pecas, 2),
    'custo_mao_obra', ROUND(v_mo, 2), 'lucro', v_lucro, 'margem', v_margem,
    'aguardando_faturamento', (v_receita IS NULL));
END $function$;

-- Relatório: receita LIVE do vínculo canônico (assim que a OS faturar, aparece sozinho,
-- zero retrabalho). Custo do snapshot (congelado/real). Lucro só quando há receita.
CREATE OR REPLACE FUNCTION public.fn_manutencoes_relatorio(
  p_company_id uuid, p_cliente_id uuid DEFAULT NULL, p_data_ini date DEFAULT NULL,
  p_data_fim date DEFAULT NULL, p_placa text DEFAULT NULL, p_mecanico text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_res jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  WITH base AS (
    SELECT o.id, o.numero, o.entregue_em, o.cliente_nome, o.cliente_id, o.placa,
           COALESCE(o.marca,'') || CASE WHEN o.modelo IS NOT NULL THEN ' ' || o.modelo ELSE '' END AS veiculo,
           o.tecnico_nome,
           COALESCE(o.custo_pecas_snapshot, 0) AS custo_pecas,
           COALESCE(o.custo_mao_obra_snapshot, 0) AS custo_mo,
           (SELECT SUM(r.valor) FROM erp_receber r
             WHERE r.company_id = o.company_id AND r.ref_externa_sistema = 'os'
               AND r.ref_externa_id = o.id::text AND r.deleted_at IS NULL) AS receita
    FROM erp_os o
    WHERE o.company_id = p_company_id AND o.status = 'entregue'
      AND (p_cliente_id IS NULL OR o.cliente_id = p_cliente_id)
      AND (p_data_ini IS NULL OR o.entregue_em::date >= p_data_ini)
      AND (p_data_fim IS NULL OR o.entregue_em::date <= p_data_fim)
      AND (p_placa IS NULL OR o.placa ILIKE '%' || p_placa || '%')
      AND (p_mecanico IS NULL OR o.tecnico_nome ILIKE '%' || p_mecanico || '%')
  ), calc AS (
    SELECT b.*,
      CASE WHEN b.receita IS NULL THEN NULL ELSE b.receita - (b.custo_pecas + b.custo_mo) END AS lucro,
      CASE WHEN COALESCE(b.receita,0) > 0 THEN ROUND((b.receita - (b.custo_pecas + b.custo_mo)) / b.receita * 100, 1) ELSE NULL END AS margem,
      (b.receita IS NULL) AS aguardando
    FROM base b
  )
  SELECT jsonb_build_object(
    'ok', true,
    'linhas', COALESCE((SELECT jsonb_agg(to_jsonb(calc) ORDER BY calc.entregue_em DESC NULLS LAST) FROM calc), '[]'::jsonb),
    'totais', (SELECT jsonb_build_object(
        'qtd', COUNT(*),
        'receita', SUM(receita),                                  -- NULL se nenhuma faturada
        'custo_pecas', COALESCE(SUM(custo_pecas), 0),
        'custo_mo', COALESCE(SUM(custo_mo), 0),
        'lucro', SUM(lucro),                                      -- NULL se nenhuma faturada
        'ticket_medio', CASE WHEN COUNT(*) FILTER (WHERE receita IS NOT NULL) > 0
                             THEN ROUND(SUM(receita) / COUNT(*) FILTER (WHERE receita IS NOT NULL), 2) ELSE NULL END,
        'margem_media', CASE WHEN SUM(receita) > 0 THEN ROUND(SUM(lucro) / SUM(receita) * 100, 1) ELSE NULL END,
        'qtd_aguardando', COUNT(*) FILTER (WHERE aguardando)
      ) FROM calc)
  ) INTO v_res;
  RETURN v_res;
END $function$;

-- Backfill: as 20 entregues receberam receita/lucro estimados do os_total (agora mentira).
-- Anular receita/lucro/margem onde NÃO há faturamento vinculado; manter custo (real).
UPDATE public.erp_os SET receita_snapshot = NULL, lucro_snapshot = NULL, margem_snapshot = NULL, snapshot_estimado = false
 WHERE status = 'entregue' AND snapshot_em IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM erp_receber r
     WHERE r.company_id = erp_os.company_id AND r.ref_externa_sistema = 'os'
       AND r.ref_externa_id = erp_os.id::text AND r.deleted_at IS NULL);
