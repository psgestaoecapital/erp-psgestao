-- P&M · Bot no Slack · REAPER do histórico de envios (tela honesta — RD-98 critério c)
-- =====================================================================================================================
-- DIAGNÓSTICO (RD-38, provado no dado de produção em 18/11):
--   · erp_pm_bot_envio: 6.336 avisos presos em 'enfileirado' desde 06/11; apenas 3 'enviado' (seed DEMO), 0 'falhou'.
--   · A edge function 'pm-bot-enviar' devolve, nos últimos 7 dias, 128× HTTP 401 {"erro":"não autorizado"}
--     (net._http_response; o último às 04:51:49 bate exatamente com o aviso enfileirado mais recente).
--   · Causa: fn_pm_bot_disparar envia o segredo do COFRE 'SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER', mas a função
--     compara contra o seu env 'SUPABASE_SERVICE_ROLE_KEY' (linha "if Authorization !== Bearer SERVICE_KEY"); os dois
--     NÃO conferem → 401 → a linha nunca é atualizada → fica 'enfileirado' para sempre.
--   · É SISTÊMICO: o 'push-enviar' usa o MESMO segredo do cofre (ver 20261017030030_push_envio_gatilho.sql) → a
--     entrega de push também está 401. A correção do SEGREDO é OPERACIONAL (fora de PR; não mexo em segredo aqui).
--
-- O QUE ESTA MIGRATION FAZ (aditiva, não toca segredo, não toca dado de cliente):
--   Torna a tela HONESTA. Um aviso cuja entrega não foi confirmada em tempo hábil deixa de mentir "Na fila" para
--   sempre e passa a "Falhou", com motivo em linguagem do usuário (o histórico só mostra 'enviado/falhou/na fila';
--   hoje tudo fica eternamente "Na fila"). Benefício extra: quando o motor voltar (segredo corrigido), os avisos
--   VELHOS não são re-entregues de uma vez — viram histórico de falha, evitando uma INUNDAÇÃO do canal do Slack.
--
-- SEGURANÇA (SENSÍVEL → revisao-eng-chefe):
--   · Função nova SECURITY DEFINER, GRANT só service_role, REVOKE anon/authenticated/PUBLIC.
--   · Varredura de serviço/cron sem sessão de usuário: opera por STATUS (não por empresa) — por isso ci-sem-guarda.
--   · Idempotente: só toca linhas 'enfileirado' mais velhas que o corte; roda a cada 10 min por pg_cron.
--   · NÃO altera 'enviado'/'falhou' já gravados; NÃO apaga nada; NÃO toca dado de cliente.

-- ───────────────────────────────── 1) Reaper: 'enfileirado' preso → 'falhou' honesto ───────────────────────────────
-- ci-sem-guarda: fn_pm_bot_envio_reaper — varredura de serviço/cron sem sessão; opera por status (não por empresa)
CREATE OR REPLACE FUNCTION public.fn_pm_bot_envio_reaper(p_minutos int DEFAULT 15)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_n     integer;
  v_corte timestamptz;
BEGIN
  -- janela mínima de 5 min: a entrega normal confirma em segundos; só marca o que está REALMENTE preso.
  v_corte := now() - make_interval(mins => GREATEST(COALESCE(p_minutos, 15), 5));

  UPDATE public.erp_pm_bot_envio
     SET status = 'falhou',
         erro   = 'Não foi possível confirmar a entrega ao Slack. O aviso não chegou ao canal — se o problema continuar, reconecte o canal ou avise o suporte.'
   WHERE status = 'enfileirado'
     AND criado_em < v_corte;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$f$;
REVOKE ALL ON FUNCTION public.fn_pm_bot_envio_reaper(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pm_bot_envio_reaper(int) TO service_role;

COMMENT ON FUNCTION public.fn_pm_bot_envio_reaper(int) IS
  'P&M · Bot Slack: marca como "falhou" (motivo em linguagem do usuário) os avisos presos em "enfileirado" além da '
  'janela (default 15 min), para a tela não mentir "Na fila" para sempre e não inundar o canal quando o motor voltar. '
  'Serviço/cron, por status; a correção da ENTREGA (segredo do cofre) é operacional. Migration 20261120013540.';

-- ───────────────────────────────── 2) Agenda a cada 10 min (idempotente: upsert pelo nome) ─────────────────────────
SELECT cron.schedule('pm-bot-envio-reaper', '*/10 * * * *', $cron$SELECT public.fn_pm_bot_envio_reaper(15);$cron$);
