-- P&M · Bot no Slack (CEO 31/10) · FATIA 2 — MOTOR DE ENVIO + HISTÓRICO + TESTAR ENVIO
-- =====================================================================================================================
-- A fatia 1 (migration 20261105150110) conectou o canal (webhook no cofre) e deixou a agência escolher os avisos.
-- Esta fatia liga o MOTOR: o banco enfileira o aviso numa tabela de histórico (SEM o webhook) e chama a edge function
-- 'pm-bot-enviar' por pg_net (como o push-enviar do chamado #120); a função lê o webhook do COFRE pela conexão de
-- serviço e posta no Slack, gravando de volta o resultado (enviado/falhou) no histórico.
--
-- O que entra aqui:
--  1) Tabela erp_pm_bot_envio — histórico das mensagens (evento, título, texto, situação, erro) — NUNCA o webhook.
--  2) fn_pm_bot_disparar(company, evento, titulo, texto) — enfileira + chama a edge function (uso interno/serviço).
--  3) fn_pm_bot_testar(company) — manda uma mensagem de teste pelo canal conectado (botão "Testar envio" na tela).
--  4) fn_pm_bot_envio_listar(company, limite) — últimas mensagens para a seção "Histórico" da tela.
--  5) fn_pm_bot_webhook_obter(company) — devolve o webhook do cofre SÓ para a conexão de serviço (a edge function).
--  6) Ajuda de campo das novas ações (RD-95 "?") + system_screens + seed DEMO (histórico navegável).
--
-- SEGURANÇA (SENSÍVEL → revisao-eng-chefe):
--  · O webhook (segredo) continua SÓ no cofre. A tabela de histórico guarda o conteúdo do aviso, nunca o webhook.
--  · fn_pm_bot_webhook_obter é a ÚNICA porta para o valor do webhook e é GRANT só a service_role (REVOKE anon/authenticated/PUBLIC).
--  · RLS por company_id na tabela nova (SELECT por empresa); authenticated só LÊ — quem grava é a função (SECURITY DEFINER) / service_role.
--  · Defesa SSRF repetida no banco e na função: só https://hooks.slack.com/.
--  · Aditiva: 1 tabela + 4 funções novas; não toca dado de cliente.

-- ───────────────────────────────────────── 1) Tabela de histórico de envios ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_pm_bot_envio (
  id            uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id    uuid        NOT NULL,
  evento        text        NOT NULL,                       -- 'teste','novo_job','aprovacao_pendente',... (fatia 3)
  titulo        text,
  texto         text,
  status        text        NOT NULL DEFAULT 'enfileirado', -- enfileirado | enviado | falhou
  http_status   int,                                        -- código HTTP devolvido pelo Slack (ex.: 200)
  erro          text,                                       -- mensagem curta quando falhou (nunca o webhook)
  criado_em     timestamptz NOT NULL DEFAULT now(),
  criado_por    uuid,
  enviado_em    timestamptz,
  CONSTRAINT erp_pm_bot_envio_status_ck CHECK (status IN ('enfileirado','enviado','falhou')),
  CONSTRAINT erp_pm_bot_envio_evento_ck CHECK (char_length(evento) BETWEEN 1 AND 40)
);
COMMENT ON TABLE public.erp_pm_bot_envio IS
  'P&M · histórico das mensagens do bot de Slack por empresa (fatia 2). Guarda o conteúdo do aviso e o resultado; '
  'NUNCA o webhook (o segredo fica no cofre). RLS por empresa (SELECT), REVOKE anon. Migration 20261105160010.';
CREATE INDEX IF NOT EXISTS erp_pm_bot_envio_company_criado_idx
  ON public.erp_pm_bot_envio (company_id, criado_em DESC);

ALTER TABLE public.erp_pm_bot_envio ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_pm_bot_envio FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.erp_pm_bot_envio TO authenticated;
-- só leitura por empresa; a escrita é só via função SECURITY DEFINER / service_role (sem policy de INSERT/UPDATE/DELETE p/ authenticated)
DROP POLICY IF EXISTS pm_bot_envio_sel ON public.erp_pm_bot_envio;
CREATE POLICY pm_bot_envio_sel ON public.erp_pm_bot_envio FOR SELECT
  USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin());

-- ─────────────────────────── 2) RPC: devolver o webhook do cofre (SÓ service_role) ─────────────────────────────────
-- A edge function (conexão de serviço) chama esta função para obter o webhook e postar no Slack. É a única porta para
-- o valor do segredo e NÃO é acessível a usuário (REVOKE authenticated/anon/PUBLIC). Sem auth.uid(): o chamador é a
-- conexão de serviço, com o company_id que o banco já validou ao enfileirar.
CREATE OR REPLACE FUNCTION public.fn_pm_bot_webhook_obter(p_company_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'vault', 'pg_temp'
AS $f$
DECLARE v_nome text; v_wh text;
BEGIN
  SELECT nome_secret_vault INTO v_nome
    FROM public.erp_pm_bot_config
   WHERE company_id = p_company_id AND conectado IS TRUE;
  IF v_nome IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO v_wh FROM vault.decrypted_secrets WHERE name = v_nome;
  -- defesa SSRF: só o Incoming Webhook do Slack
  IF v_wh IS NULL OR v_wh !~* '^https://hooks\.slack\.com/' THEN RETURN NULL; END IF;
  RETURN v_wh;
END;
$f$;
REVOKE ALL ON FUNCTION public.fn_pm_bot_webhook_obter(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pm_bot_webhook_obter(uuid) TO service_role;

-- ───────────────────────── 3) RPC interna: enfileirar + chamar a edge function ─────────────────────────────────────
-- Uso interno (fn_pm_bot_testar e, na fatia 3, os gatilhos por evento). Grava a linha do histórico como 'enfileirado'
-- e chama a edge function por pg_net com {company_id, envio_id}. A função atualiza a linha para 'enviado'/'falhou'.
CREATE OR REPLACE FUNCTION public.fn_pm_bot_disparar(
  p_company_id uuid, p_evento text, p_titulo text, p_texto text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $f$
DECLARE v_id uuid; v_key text;
BEGIN
  INSERT INTO public.erp_pm_bot_envio (company_id, evento, titulo, texto, status, criado_por)
  VALUES (p_company_id, left(coalesce(p_evento,'teste'),40), p_titulo, p_texto, 'enfileirado', auth.uid())
  RETURNING id INTO v_id;

  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER';
  IF v_key IS NULL THEN
    UPDATE public.erp_pm_bot_envio SET status='falhou', erro='motor de envio indisponível (chave de serviço ausente)'
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  PERFORM net.http_post(
    url     := 'https://horsymhsinqcimflrtjo.supabase.co/functions/v1/pm-bot-enviar',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
    body    := jsonb_build_object('company_id', p_company_id, 'envio_id', v_id),
    timeout_milliseconds := 10000
  );
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  IF v_id IS NOT NULL THEN
    UPDATE public.erp_pm_bot_envio SET status='falhou', erro=left(SQLERRM,200) WHERE id = v_id;
  END IF;
  RETURN v_id;
END;
$f$;
REVOKE ALL ON FUNCTION public.fn_pm_bot_disparar(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pm_bot_disparar(uuid, text, text, text) TO service_role;

-- ───────────────────────────────── 4) RPC: testar envio (botão na tela) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pm_bot_testar(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $f$
DECLARE v_conectado boolean; v_canal text; v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  PERFORM public.fn__guarda_empresa(p_company_id);

  SELECT conectado, canal_nome INTO v_conectado, v_canal
    FROM public.erp_pm_bot_config WHERE company_id = p_company_id;
  IF NOT coalesce(v_conectado, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Conecte um canal do Slack antes de testar o envio.');
  END IF;

  v_id := public.fn_pm_bot_disparar(
    p_company_id, 'teste', 'PS Gestão · teste do bot',
    'Mensagem de teste do canal ' || coalesce(v_canal, '(sem apelido)') || '. Se você está lendo isto no Slack, o bot está funcionando. ✅');

  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (p_company_id, auth.uid(), 'erp_pm_bot_envio', v_id::text, 'testar', NULL, jsonb_build_object('evento','teste'));

  RETURN jsonb_build_object('ok', true, 'envio_id', v_id);
END;
$f$;
REVOKE ALL ON FUNCTION public.fn_pm_bot_testar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_bot_testar(uuid) TO authenticated, service_role;

-- ──────────────────────────────── 5) RPC: histórico das últimas mensagens ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pm_bot_envio_listar(p_company_id uuid, p_limite int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE v_lim int; v_out jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  PERFORM public.fn__guarda_empresa(p_company_id);
  v_lim := LEAST(GREATEST(coalesce(p_limite, 20), 1), 100);
  SELECT coalesce(jsonb_agg(x ORDER BY x.criado_em DESC), '[]'::jsonb) INTO v_out
  FROM (
    SELECT id, evento, titulo, texto, status, http_status, erro, criado_em, enviado_em
      FROM public.erp_pm_bot_envio
     WHERE company_id = p_company_id
     ORDER BY criado_em DESC
     LIMIT v_lim
  ) x;
  RETURN v_out;
END;
$f$;
REVOKE ALL ON FUNCTION public.fn_pm_bot_envio_listar(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_bot_envio_listar(uuid, int) TO authenticated, service_role;

-- ─────────────────────────────────────────── 6) Ajuda de campo (RD-95 "?") ─────────────────────────────────────────
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status) VALUES
 ('pm.bot.testar','/dashboard/pm/bot','Bot no Slack','Testar envio',
  'Toque para enviar uma mensagem de teste ao canal conectado agora.',
  'Confirma, em segundos, que o canal recebe as mensagens do bot — sem esperar um evento real acontecer.',
  'Conectou o canal e quer ter certeza: toque em Testar envio e confira o Slack.',
  'Testar sem ter conectado um canal: conecte o webhook primeiro.','pm',13,'publicado'),
 ('pm.bot.historico','/dashboard/pm/bot','Bot no Slack','Histórico de envios',
  'Lista as últimas mensagens que o bot tentou enviar, com a situação de cada uma (enviada, falhou ou na fila).',
  'Mostra o que já saiu para o Slack e ajuda a descobrir um envio que falhou (ex.: canal removido).',
  '"Teste do bot — enviada agora." / "Novo job — falhou (canal não encontrado)."',
  'Achar que a mensagem sumiu: toda tentativa fica registrada aqui, mesmo quando falha.','pm',14,'publicado'),
 ('pm.bot.envio_status','/dashboard/pm/bot','Bot no Slack','Situação do envio',
  'Cada linha mostra se a mensagem foi Enviada, Falhou ou ainda está Na fila (acabou de sair e aguarda a confirmação do Slack).',
  'Deixa claro o que chegou ao canal e o que precisa de atenção.',
  'Na fila → Enviada em poucos segundos; atualize para ver.',
  'Confundir "Na fila" com erro: é só o aviso recém-enfileirado; atualize para ver o resultado.','pm',15,'publicado')
ON CONFLICT (chave) DO NOTHING;

-- atualiza o texto do "o que vem a seguir" para a fatia 3 (gatilhos por evento)
UPDATE erp_ajuda_campo
   SET o_que_preencher = 'Já funciona conectar, escolher avisos, testar e ver o histórico. A próxima fatia liga os avisos automáticos por evento (novo job, prazo em 24h etc.).',
       exemplo = 'Conectou e testou: falta ligar o disparo automático por evento (próxima fatia).'
 WHERE chave = 'pm.bot.proximo';

-- ───────────────────────────────── 7) Origem do dado (RD-98 p3): system_screens ────────────────────────────────────
UPDATE system_screens
   SET descricao_funcional = 'P&M · Bot no Slack (V1 notificações): conecta um canal do Slack por webhook (guardado no cofre), escolhe quais avisos receber, testa o envio e vê o histórico das mensagens. O disparo automático por evento entra na fatia seguinte.',
       views_consumidas = ARRAY['erp_pm_bot_config','erp_pm_bot_envio']::text[],
       rpcs_chamadas = ARRAY['fn_pm_bot_config_obter','fn_pm_bot_conectar','fn_pm_bot_eventos_salvar','fn_pm_bot_desconectar','fn_pm_bot_testar','fn_pm_bot_envio_listar']::text[]
 WHERE rota = '/dashboard/pm/bot';

-- ───────────────────────────────── 8) Seed DEMO (histórico navegável) ──────────────────────────────────────────────
-- Mostra a seção Histórico já com conteúdo na DEMO (Agência P&M - DEMO), para a tela não parecer vazia/quebrada
-- (RD-98 p1). Idempotente: só insere se a empresa DEMO existir e ainda não houver histórico dela.
DO $seed$
DECLARE v_company uuid := 'b0700000-0000-4000-a000-000000000002';  -- Agência (P&M) - DEMO
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = v_company)
     AND NOT EXISTS (SELECT 1 FROM public.erp_pm_bot_envio WHERE company_id = v_company) THEN
    INSERT INTO public.erp_pm_bot_envio (company_id, evento, titulo, texto, status, http_status, criado_em, enviado_em) VALUES
      (v_company, 'teste', 'PS Gestão · teste do bot', 'Mensagem de teste do canal #jobs-agencia. ✅', 'enviado', 200, now() - interval '2 days', now() - interval '2 days'),
      (v_company, 'novo_job', 'Novo job: Campanha de Natal', 'Entrou um job novo para o cliente Boticário.', 'enviado', 200, now() - interval '1 day', now() - interval '1 day'),
      (v_company, 'prazo_24h', 'Prazo em 24h: Job Natura', 'O job Natura vence amanhã às 18h.', 'enviado', 200, now() - interval '3 hours', now() - interval '3 hours');
  END IF;
END
$seed$;
