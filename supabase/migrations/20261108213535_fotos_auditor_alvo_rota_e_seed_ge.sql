-- Captura do auditor visual (aud8claudeps): infra de foto por rota + eficiência do batch + seed da DEMO GE.
-- Regras: RD-69/LGPD (nunca renderizar empresa real: só DEMO), RD-38 (aceite provado no dado), dado da DEMO apenas.
--
-- 1) fn_disparar_playwright_batch: CREATE OR REPLACE idêntico ao vivo + UMA linha nova no WHERE:
--    s.area IN (áreas com DEMO), set-based. Equivale a fn_demo_da_area(s.area) IS NOT NULL, sem chamada por linha.
--    Efeito: o LIMIT do lote só conta tela fotografável (áreas sem DEMO deixavam de comer o lote).
--    A guarda interna (fn_demo_da_area → 'sem_demo') continua.
-- 2) fn_disparar_playwright_rota(p_rota): captura DIRIGIDA de uma rota. Mesmo POST do batch (mesmo header e body).
--    Só service_role executa (não é função de usuário final). Sem DEMO para a área → {ok:false, motivo:'sem_demo'}.
-- 3) Seed idempotente de 3 linhas de negócio na DEMO GE (b0700000-…0004). Dado fictício; WHERE NOT EXISTS.
--
-- Aditiva no efeito: nenhuma tabela nova, nenhum dado real tocado. Timestamp acima da última da main.

-- ── 1. Batch: mesmo corpo do vivo + filtro set-based de DEMO ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_disparar_playwright_batch(p_limit integer DEFAULT 10, p_modo text DEFAULT 'baseline'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_screen RECORD; v_request_id bigint; v_disparados int := 0; v_errors int := 0;
  v_pulados_sem_demo int := 0; v_resultados jsonb := '[]'::jsonb; v_empresa uuid;
BEGIN
  FOR v_screen IN
    SELECT s.id, s.rota, s.area, s.screenshot_atualizado_em, s.prioridade_monitoramento
    FROM system_screens s
    WHERE s.rota NOT LIKE '%[%'
      AND s.area IN (SELECT d.area FROM demo_por_area d JOIN companies c ON c.id = d.company_id AND c.is_demo = true)
      AND ( (p_modo = 'baseline' AND s.screenshot_url IS NULL)
         OR (p_modo = 'refresh'  AND (s.screenshot_url IS NULL OR s.screenshot_atualizado_em < NOW() - INTERVAL '5 minutes')) )
    ORDER BY CASE s.prioridade_monitoramento WHEN 'critica' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 ELSE 4 END,
             s.screenshot_atualizado_em ASC NULLS FIRST
    LIMIT p_limit
  LOOP
    v_empresa := fn_demo_da_area(v_screen.area);
    IF v_empresa IS NULL THEN
      -- área sem demo mapeada → NÃO fotografa (RD-69/LGPD: nunca renderizar empresa real)
      v_pulados_sem_demo := v_pulados_sem_demo + 1;
      v_resultados := v_resultados || jsonb_build_object('rota', v_screen.rota, 'area', v_screen.area, 'status', 'sem_demo');
      CONTINUE;
    END IF;
    BEGIN
      SELECT net.http_post(
        url := 'https://erp-psgestao.vercel.app/api/screen-watcher/playwright',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-watcher-secret', public.fn_watcher_secret()),
        body := jsonb_build_object('rota', v_screen.rota, 'empresa_id', v_empresa),
        timeout_milliseconds := 90000
      ) INTO v_request_id;
      v_disparados := v_disparados + 1;
      v_resultados := v_resultados || jsonb_build_object('rota', v_screen.rota, 'area', v_screen.area, 'empresa_id', v_empresa, 'request_id', v_request_id);
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
    END;
  END LOOP;
  RETURN jsonb_build_object('executado_em', NOW(), 'modo', p_modo,
    'disparados', v_disparados, 'pulados_sem_demo', v_pulados_sem_demo, 'erros', v_errors, 'detalhes', v_resultados);
END $function$;

-- ── 2. Captura dirigida de uma rota (só service_role) ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_disparar_playwright_rota(p_rota text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_area text;
  v_empresa uuid;
  v_request_id bigint;
BEGIN
  -- rota concreta apenas (rota dinâmica com colchetes não é fotografada, igual ao batch)
  IF p_rota IS NULL OR p_rota = '' OR p_rota LIKE '%[%' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'rota_invalida');
  END IF;

  SELECT s.area INTO v_area FROM system_screens s WHERE s.rota = p_rota ORDER BY s.id LIMIT 1;
  IF v_area IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'tela_nao_encontrada', 'rota', p_rota);
  END IF;

  -- RD-69/LGPD: sem DEMO mapeada para a área, não renderiza nada
  v_empresa := fn_demo_da_area(v_area);
  IF v_empresa IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem_demo', 'rota', p_rota, 'area', v_area);
  END IF;

  BEGIN
    SELECT net.http_post(
      url := 'https://erp-psgestao.vercel.app/api/screen-watcher/playwright',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-watcher-secret', public.fn_watcher_secret()),
      body := jsonb_build_object('rota', p_rota, 'empresa_id', v_empresa),
      timeout_milliseconds := 90000
    ) INTO v_request_id;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'erro_disparo', 'rota', p_rota);
  END;

  RETURN jsonb_build_object('ok', true, 'rota', p_rota, 'empresa_id', v_empresa, 'request_id', v_request_id);
END
$fn$;

REVOKE ALL ON FUNCTION public.fn_disparar_playwright_rota(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_disparar_playwright_rota(text) TO service_role;

-- ── 3. Seed idempotente: linhas de negócio da DEMO GE (dado fictício; não toca dado real) ───────────────
INSERT INTO linhas_negocio (empresa_id, nome, descricao, cor, ativo, ordem)
SELECT v.empresa_id, v.nome, v.descricao, v.cor, true, v.ordem
  FROM (VALUES
    ('b0700000-0000-4000-a000-000000000004'::uuid, 'Varejo',   'Vendas no balcão e varejo',       '#C8941A', 1),
    ('b0700000-0000-4000-a000-000000000004'::uuid, 'Atacado',  'Vendas em volume para revenda',   '#3D2314', 2),
    ('b0700000-0000-4000-a000-000000000004'::uuid, 'Serviços', 'Serviços e assistência técnica',  '#7A5C3E', 3)
  ) AS v(empresa_id, nome, descricao, cor, ordem)
 WHERE NOT EXISTS (
   SELECT 1 FROM linhas_negocio l WHERE l.empresa_id = v.empresa_id AND l.nome = v.nome
 );
