-- Miniatura base64 da foto da tela (aud8 no Max). A captura grava a miniatura nesta tabela; o aud8 lê por
-- fn_screenshot_thumb (SELECT síncrono pelo MCP), porque o ambiente dele bloqueia o storage (403).
-- Tabela separada de system_screens: base64 pesado não entra nas leituras do painel. Só service_role.

CREATE TABLE IF NOT EXISTS public.erp_screen_thumb (
  rota           text PRIMARY KEY,
  thumb_b64      text NOT NULL,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  company_id     uuid
);
ALTER TABLE public.erp_screen_thumb ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_screen_thumb FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.erp_screen_thumb TO service_role;

-- Leitura para o aud8: { ok, rota, atualizado_em, base64, aviso }. Sem miniatura devolve ok=false; miniatura com mais
-- de 24h devolve o aviso para disparar a captura. Como o aud8 usa: SELECT fn_screenshot_thumb('<rota>'), decodifica o
-- base64 (JPEG de 480 px) e avalia layout, dados e bugs visuais; a nota vai para fn_matriz_registrar_nota.
CREATE OR REPLACE FUNCTION public.fn_screenshot_thumb(p_rota text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE r record;
BEGIN
  SELECT t.rota, t.thumb_b64, t.atualizado_em INTO r FROM erp_screen_thumb t WHERE t.rota = p_rota;
  IF NOT FOUND OR r.thumb_b64 IS NULL OR r.thumb_b64 = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'miniatura_ausente', 'rota', p_rota,
                              'aviso', 'sem miniatura desta rota: dispare a captura');
  END IF;
  RETURN jsonb_build_object('ok', true, 'rota', r.rota, 'atualizado_em', r.atualizado_em, 'base64', r.thumb_b64,
    'aviso', CASE WHEN r.atualizado_em < now() - interval '24 hours'
                  THEN 'miniatura com mais de 24h: dispare a captura' ELSE NULL END);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_screenshot_thumb(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_screenshot_thumb(text) TO service_role;
