-- =============================================================
-- G1 · Gold Camada 2 com Playwright real + Claude vision
-- CEO 27/05/2026 ~20:35 BRT · Saneamento V1 Fase 3 · Telas Reais
-- Aplicado via MCP apply_migration · rastreio historico.
-- Pacto: erp_contexto_projeto d3b91a21 · Pre-req: 578bee32
-- =============================================================

ALTER TABLE gold_camada2_validacoes
  ADD COLUMN IF NOT EXISTS spec_fix_preliminar jsonb,
  ADD COLUMN IF NOT EXISTS dom_resumo jsonb,
  ADD COLUMN IF NOT EXISTS playwright_real boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS auth_status text;

COMMENT ON COLUMN gold_camada2_validacoes.spec_fix_preliminar IS
  'Spec preliminar de fix gerada pelo Claude quando veredito=bronze/bloqueado';
COMMENT ON COLUMN gold_camada2_validacoes.dom_resumo IS
  'DOM resumido pos-clique: links/botoes/valores BRL detectados';
COMMENT ON COLUMN gold_camada2_validacoes.playwright_real IS
  'true=Fase 3 (clique real). false=Fase 2 stub HTTP';
COMMENT ON COLUMN gold_camada2_validacoes.auth_status IS
  'autenticado | redirected_login | erro_session | sem_localStorage';

CREATE OR REPLACE FUNCTION public.fn_gold_g1_veredito_agregado_rota(
  p_rota text,
  p_apos timestamptz DEFAULT NOW() - INTERVAL '5 minutes'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total int;
  v_ouro int;
  v_prata int;
  v_bronze int;
  v_bloqueado int;
  v_custo numeric;
  v_pior text;
BEGIN
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE v.veredito_camada2 = 'verde'),
    COUNT(*) FILTER (WHERE v.veredito_camada2 = 'amarelo'),
    COUNT(*) FILTER (WHERE v.veredito_camada2 = 'vermelho' AND NOT COALESCE((v.claude_analysis_jornada->>'bloqueado')::boolean, false)),
    COUNT(*) FILTER (WHERE v.veredito_camada2 = 'vermelho' AND COALESCE((v.claude_analysis_jornada->>'bloqueado')::boolean, false)),
    COALESCE(SUM(v.claude_custo_usd), 0)
  INTO v_total, v_ouro, v_prata, v_bronze, v_bloqueado, v_custo
  FROM gold_camada2_validacoes v
  JOIN gold_screen_buttons b ON b.id = v.botao_id
  WHERE b.rota = p_rota
    AND v.playwright_real = true
    AND v.executado_em >= p_apos;

  IF v_total = 0 THEN
    RETURN jsonb_build_object('rota', p_rota, 'erro', 'nenhuma validacao Fase 3 nesse intervalo');
  END IF;

  v_pior := CASE
    WHEN v_bloqueado > 0 THEN 'BLOQUEADO'
    WHEN v_bronze > 0 THEN 'BRONZE'
    WHEN v_prata > 0 THEN 'PRATA'
    ELSE 'OURO'
  END;

  RETURN jsonb_build_object(
    'rota', p_rota,
    'apos', p_apos,
    'total_botoes', v_total,
    'ouro', v_ouro,
    'prata', v_prata,
    'bronze', v_bronze,
    'bloqueado', v_bloqueado,
    'custo_total_usd', v_custo,
    'veredito_pior_botao', v_pior
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_gold_g1_veredito_agregado_rota(text, timestamptz) TO authenticated, service_role;
