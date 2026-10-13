-- Auditoria Gold — B-correção (as 3 correções que o CEO pediu):
--
-- (2) "não testável" ≠ vermelho: botão atrás de uma PRECONDIÇÃO que o robô não satisfaz (ex.: exige
--     planta/obra selecionada, empresa com dados) não está QUEBRADO — está NÃO TESTÁVEL. Hoje ele cai
--     em 'vermelho' (seletor_nao_visivel), poluindo o veredito. Antes só havia isenção para botões
--     'opcional'; generalizamos com uma coluna precondicao explícita + veredito 'nao_testavel'.
-- (3) contexto do bot: os botões de engenharia (c6e370aa) só aparecem após selecionar planta — o bot
--     não tem esse contexto. Com precondicao declarada, viram 'nao_testavel', não falso-vermelho.
-- (1) Camada 3 só APÓS a captura (o race ddc30bea): a Camada 3 (insight) era disparada em t0, antes do
--     screenshot novo existir, e lia a FOTO VELHA. A consolidação passa a só CONTAR um veredito de
--     Camada 3 cujo screenshot foi capturado DEPOIS do início da jornada (screenshot_capturado_em > t0).
--     Sem captura fresca, Camada 3 = 'pendente' (honesto), nunca um veredito de arqueologia.

-- (2) coluna precondicao
ALTER TABLE public.gold_screen_buttons
  ADD COLUMN IF NOT EXISTS precondicao text;
COMMENT ON COLUMN public.gold_screen_buttons.precondicao
  IS 'Se preenchida, descreve a condição que precisa estar satisfeita para o botão ser alcançável (ex.: "requer planta selecionada"). Quando o robô não acha o seletor E há precondicao, o veredito é nao_testavel — não vermelho.';

-- (2) veredito 'nao_testavel' permitido
ALTER TABLE public.gold_camada2_validacoes
  DROP CONSTRAINT IF EXISTS gold_camada2_validacoes_veredito_camada2_check;
ALTER TABLE public.gold_camada2_validacoes
  ADD CONSTRAINT gold_camada2_validacoes_veredito_camada2_check
  CHECK (veredito_camada2 = ANY (ARRAY['verde','amarelo','vermelho','pendente','nao_testavel']));

-- (1)+(2) consolidação: neutro generalizado + Camada 3 só com foto fresca
CREATE OR REPLACE FUNCTION public.fn_gold_consolidar_veredito_triplo(p_rota text, p_t0 timestamp with time zone, p_pr_numero integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_botoes_total INT := 0;
  v_botoes_verde INT := 0;
  v_botoes_amarelo INT := 0;
  v_botoes_vermelho INT := 0;
  v_botoes_neutro INT := 0;
BEGIN
  SELECT id INTO v_screen_id FROM system_screens WHERE rota = p_rota LIMIT 1;

  SELECT id INTO v_c1_id
  FROM rd38_playwright_falhas
  WHERE rota_solicitada = p_rota AND detectado_em > p_t0
  ORDER BY detectado_em DESC LIMIT 1;
  v_c1 := CASE WHEN v_c1_id IS NULL THEN 'verde' ELSE 'vermelho' END;

  -- neutro = não testável (precondição não satisfeita, qualquer prioridade) OU o caso legado
  -- opcional+seletor_nao_visivel. Neutro NÃO conta como vermelho nem entra no total.
  WITH ultima_por_botao AS (
    SELECT DISTINCT ON (v2.botao_id)
      v2.botao_id, v2.id, v2.veredito_camada2, v2.claude_custo_usd, v2.motivo_veredito,
      sb.prioridade,
      (v2.veredito_camada2 = 'nao_testavel'
       OR (sb.prioridade = 'opcional' AND v2.motivo_veredito ILIKE '%seletor_nao_visivel%')) AS neutro
    FROM gold_camada2_validacoes v2
    JOIN gold_screen_buttons sb ON sb.id = v2.botao_id
    WHERE sb.rota = p_rota AND v2.executado_em > p_t0
    ORDER BY v2.botao_id, v2.executado_em DESC
  )
  SELECT
    COUNT(*) FILTER (WHERE NOT neutro),
    COUNT(*) FILTER (WHERE veredito_camada2 = 'verde' AND NOT neutro),
    COUNT(*) FILTER (WHERE veredito_camada2 = 'amarelo' AND NOT neutro),
    COUNT(*) FILTER (WHERE veredito_camada2 = 'vermelho' AND NOT neutro),
    COUNT(*) FILTER (WHERE neutro),
    SUM(COALESCE(claude_custo_usd, 0))
  INTO v_botoes_total, v_botoes_verde, v_botoes_amarelo, v_botoes_vermelho, v_botoes_neutro, v_c2_custo
  FROM ultima_por_botao;

  SELECT id INTO v_c2_id FROM (
    SELECT DISTINCT ON (v2.botao_id) v2.id, v2.veredito_camada2, v2.executado_em, sb.prioridade, v2.motivo_veredito
    FROM gold_camada2_validacoes v2
    JOIN gold_screen_buttons sb ON sb.id = v2.botao_id
    WHERE sb.rota = p_rota AND v2.executado_em > p_t0
      AND v2.veredito_camada2 <> 'nao_testavel'
      AND NOT (sb.prioridade = 'opcional' AND v2.motivo_veredito ILIKE '%seletor_nao_visivel%')
    ORDER BY v2.botao_id, v2.executado_em DESC
  ) u
  ORDER BY CASE u.veredito_camada2 WHEN 'vermelho' THEN 1 WHEN 'amarelo' THEN 2 ELSE 3 END,
           u.executado_em DESC
  LIMIT 1;

  IF v_botoes_total = 0 THEN v_c2 := 'pendente';
  ELSIF v_botoes_vermelho > 0 THEN v_c2 := 'vermelho';
  ELSIF v_botoes_amarelo > 0 THEN v_c2 := 'amarelo';
  ELSE v_c2 := 'verde';
  END IF;

  -- Camada 3 (insight): só conta se o SCREENSHOT foi capturado APÓS o início da jornada (p_t0).
  -- Foto velha (screenshot_capturado_em <= t0 ou NULL) = arqueologia → não conta → Camada 3 pendente.
  SELECT id,
    CASE
      WHEN score_visual >= 80 AND score_funcional >= 80 THEN 'verde'
      WHEN score_visual >= 60 AND score_funcional >= 60 THEN 'amarelo'
      ELSE 'vermelho'
    END,
    COALESCE(claude_custo_usd, 0)
    INTO v_c3_id, v_c3, v_c3_custo
  FROM system_screens_insights
  WHERE rota = p_rota
    AND analisado_em > p_t0
    AND screenshot_capturado_em IS NOT NULL
    AND screenshot_capturado_em > p_t0
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
    WHEN v_veredito IN ('OURO','PRATA') THEN 'sem_acao'
    WHEN v_veredito IN ('BRONZE','SUSPEITO') THEN 'amarelo_sugerido'
    WHEN v_veredito = 'BLOQUEADO' THEN 'vermelho_ceo'
    ELSE 'sem_acao'
  END;

  v_alertar_ec := v_veredito IN ('BRONZE', 'SUSPEITO');
  v_alertar_ceo := v_veredito = 'BLOQUEADO';

  INSERT INTO gold_veredito_triplo (
    screen_id, rota, pr_numero, executado_em,
    camada1_status, camada1_evidencia_id, camada2_status, camada2_evidencia_id,
    camada3_status, camada3_evidencia_id, veredito_final, politica_fix,
    alertou_engenheiro_chefe, alertou_ceo, custo_total_usd, notas
  ) VALUES (
    v_screen_id, p_rota, p_pr_numero, p_t0,
    v_c1, v_c1_id, v_c2, v_c2_id, v_c3, v_c3_id, v_veredito, v_politica,
    v_alertar_ec, v_alertar_ceo, v_custo_total,
    'Botoes: ' || v_botoes_total || ' (verde=' || v_botoes_verde ||
    ' amarelo=' || v_botoes_amarelo || ' vermelho=' || v_botoes_vermelho ||
    ' nao_testavel=' || v_botoes_neutro || ')'
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'veredito_id', v_id, 'rota', p_rota,
    'camada1', v_c1, 'camada2', v_c2, 'camada3', v_c3,
    'veredito_final', v_veredito, 'politica_fix', v_politica,
    'alertou_engenheiro_chefe', v_alertar_ec, 'alertou_ceo', v_alertar_ceo,
    'custo_total_usd', v_custo_total,
    'botoes_total', v_botoes_total, 'botoes_verde', v_botoes_verde,
    'botoes_amarelo', v_botoes_amarelo, 'botoes_vermelho', v_botoes_vermelho,
    'botoes_nao_testavel', v_botoes_neutro
  );
END;
$function$;
