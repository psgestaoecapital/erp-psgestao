-- AUDITORIA GOLD FASE 2 · RPC consolida veredito triplo + alerta automático
-- Aplicado via MCP apply_migration 25/05/2026 ~22:50 BRT
--
-- Correções vs briefing:
-- (1) camada1_evidencia_id local: BIGINT (não UUID) — type do rd38_playwright_falhas.id
-- (2) Custos das camadas 2 e 3 SOMADOS em v_custo_total (briefing sobrescrevia)
-- (3) erp_contexto_projeto sem emojis (CLAUDE.md instruction)

CREATE OR REPLACE FUNCTION public.fn_gold_consolidar_veredito_triplo(
  p_rota TEXT,
  p_t0 TIMESTAMPTZ,
  p_pr_numero INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_screen_id TEXT;
  v_c1 TEXT := 'pendente';
  v_c2 TEXT := 'pendente';
  v_c3 TEXT := 'pendente';
  v_c1_id BIGINT;
  v_c2_id UUID;
  v_c3_id BIGINT;
  v_c2_custo NUMERIC := 0;
  v_c3_custo NUMERIC := 0;
  v_custo_total NUMERIC := 0;
  v_veredito TEXT;
  v_politica TEXT;
  v_alertar_ec BOOLEAN := FALSE;
  v_alertar_ceo BOOLEAN := FALSE;
  v_id UUID;
BEGIN
  SELECT id INTO v_screen_id FROM system_screens WHERE rota = p_rota LIMIT 1;

  SELECT id INTO v_c1_id
  FROM rd38_playwright_falhas
  WHERE rota_solicitada = p_rota AND detectado_em > p_t0
  ORDER BY detectado_em DESC LIMIT 1;
  v_c1 := CASE WHEN v_c1_id IS NULL THEN 'verde' ELSE 'vermelho' END;

  SELECT v2.id, v2.veredito_camada2, COALESCE(v2.claude_custo_usd, 0)
    INTO v_c2_id, v_c2, v_c2_custo
  FROM gold_camada2_validacoes v2
  JOIN gold_screen_buttons sb ON sb.id = v2.botao_id
  WHERE sb.rota = p_rota AND v2.executado_em > p_t0
  ORDER BY v2.executado_em DESC LIMIT 1;
  IF v_c2 IS NULL THEN v_c2 := 'pendente'; END IF;

  SELECT id,
    CASE
      WHEN score_visual >= 80 AND score_funcional >= 80 THEN 'verde'
      WHEN score_visual >= 60 AND score_funcional >= 60 THEN 'amarelo'
      ELSE 'vermelho'
    END,
    COALESCE(claude_custo_usd, 0)
    INTO v_c3_id, v_c3, v_c3_custo
  FROM system_screens_insights
  WHERE rota = p_rota AND analisado_em > p_t0
  ORDER BY analisado_em DESC LIMIT 1;
  IF v_c3 IS NULL THEN v_c3 := 'pendente'; END IF;

  v_custo_total := v_c2_custo + v_c3_custo;

  v_veredito := CASE
    WHEN v_c1='verde' AND v_c2='verde' AND v_c3='verde' THEN 'OURO'
    WHEN (v_c1='verde' AND v_c2='verde' AND v_c3='amarelo')
      OR (v_c1='verde' AND v_c2='amarelo' AND v_c3='verde')
      OR (v_c1='amarelo' AND v_c2='verde' AND v_c3='verde') THEN 'PRATA'
    WHEN ((v_c1='vermelho')::int + (v_c2='vermelho')::int + (v_c3='vermelho')::int) >= 2 THEN 'BLOQUEADO'
    WHEN (v_c1='vermelho' OR v_c2='vermelho' OR v_c3='vermelho') THEN 'BRONZE'
    WHEN (v_c1='pendente' OR v_c2='pendente' OR v_c3='pendente') THEN 'PENDENTE'
    ELSE 'SUSPEITO'
  END;

  v_politica := CASE
    WHEN v_veredito = 'OURO' THEN 'sem_acao'
    WHEN v_veredito = 'PRATA' THEN 'sem_acao'
    WHEN v_veredito = 'BRONZE' THEN 'amarelo_sugerido'
    WHEN v_veredito = 'SUSPEITO' THEN 'amarelo_sugerido'
    WHEN v_veredito = 'BLOQUEADO' THEN 'vermelho_ceo'
    ELSE 'sem_acao'
  END;

  v_alertar_ec := v_veredito IN ('BRONZE', 'SUSPEITO');
  v_alertar_ceo := v_veredito = 'BLOQUEADO';

  INSERT INTO gold_veredito_triplo (
    screen_id, rota, pr_numero, executado_em,
    camada1_status, camada1_evidencia_id,
    camada2_status, camada2_evidencia_id,
    camada3_status, camada3_evidencia_id,
    veredito_final, politica_fix,
    alertou_engenheiro_chefe, alertou_ceo,
    custo_total_usd
  ) VALUES (
    v_screen_id, p_rota, p_pr_numero, p_t0,
    v_c1, v_c1_id,
    v_c2, v_c2_id,
    v_c3, v_c3_id,
    v_veredito, v_politica,
    v_alertar_ec, v_alertar_ceo,
    v_custo_total
  ) RETURNING id INTO v_id;

  IF v_veredito IN ('BLOQUEADO', 'SUSPEITO') THEN
    INSERT INTO erp_contexto_projeto (
      projeto, categoria, prioridade, status, titulo, descricao, refs, tags, criado_por
    ) VALUES (
      'erp_psgestao', 'descoberta',
      CASE WHEN v_veredito = 'BLOQUEADO' THEN 'critica' ELSE 'alta' END,
      'ativo',
      'AUDITORIA GOLD - ' || v_veredito || ' detectado em ' || p_rota,
      'Veredito Triplo: C1=' || v_c1 || ' C2=' || v_c2 || ' C3=' || v_c3 || '. Investigar.',
      jsonb_build_object('veredito_id', v_id, 'rota', p_rota, 'pr', p_pr_numero),
      ARRAY['auditoria_gold', 'veredito_' || LOWER(v_veredito), 'auto_alerta'],
      'auditoria_gold_automatico'
    );
  END IF;

  RETURN jsonb_build_object(
    'veredito_id', v_id,
    'rota', p_rota,
    'camada1', v_c1, 'camada2', v_c2, 'camada3', v_c3,
    'veredito_final', v_veredito,
    'politica_fix', v_politica,
    'alertou_engenheiro_chefe', v_alertar_ec,
    'alertou_ceo', v_alertar_ceo,
    'custo_total_usd', v_custo_total
  );
END;
$$;
