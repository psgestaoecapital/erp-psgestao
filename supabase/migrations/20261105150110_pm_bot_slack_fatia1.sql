-- P&M · Bot no Slack (CEO 31/10) · FATIA 1 — conectar canal + escolher eventos
-- =====================================================================================================================
-- V1 do bot é NOTIFICAÇÃO: a agência conecta um canal do Slack (por um "Incoming Webhook") e escolhe quais avisos
-- quer receber (novo job, aprovação pendente do cliente, prazo vencendo em 24h, job atrasado, estouro de horas do
-- contrato). O CEO escolheu Slack (gratuito); WhatsApp só quando o cliente pagar (fatia futura).
--
-- SEGURANÇA (SENSÍVEL → revisao-eng-chefe):
--  · O webhook do Slack é um SEGREDO (quem o tem posta no canal). Ele NUNCA é guardado em tabela comum nem em log:
--    vai para o COFRE (vault), com um nome por empresa (pm_bot_slack_webhook:<company_id>), lido só pela conexão de
--    serviço na fatia de envio. A tabela de config guarda apenas o NOME do segredo no vault, nunca o valor.
--  · RLS por company_id em toda a tabela nova; REVOKE anon; policy não-permissiva (nada de qual=true).
--  · Toda conexão/alteração/desconexão fica em audit_log_global (sem o valor do webhook).
--  · Aditiva: cria 1 tabela + 4 RPCs novas; não toca em dado de cliente.
--
-- Fatia 2 (próxima): edge function pm-bot-enviar (lê o webhook do vault via service_role e posta no Slack) + histórico
-- erp_pm_bot_envio (sem token). Fatia 3: gatilhos/fila por evento. Fatia 4: ampliar seed DEMO.

-- ─────────────────────────────────────────────── 1) Tabela de configuração ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_pm_bot_config (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id       uuid        NOT NULL,
  canal_nome       text,                       -- nome amigável do canal (ex.: "#jobs-agencia"); só para exibição
  conectado        boolean     NOT NULL DEFAULT false,
  nome_secret_vault text,                      -- NOME do segredo no cofre (nunca o valor); NULL quando desconectado
  eventos          jsonb       NOT NULL DEFAULT jsonb_build_object(
                                 'novo_job', true, 'aprovacao_pendente', true, 'prazo_24h', true,
                                 'job_atrasado', true, 'estouro_horas', true),
  conectado_em     timestamptz,
  conectado_por    uuid,
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_por   uuid,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_pm_bot_config_company_uk UNIQUE (company_id)
);
COMMENT ON TABLE public.erp_pm_bot_config IS
  'P&M · config do bot de notificações no Slack por empresa (CEO 31/10). O webhook (segredo) fica no cofre/vault — '
  'aqui só o NOME do segredo. RLS por empresa, REVOKE anon. Migration 20261104234110.';

ALTER TABLE public.erp_pm_bot_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_pm_bot_config FROM PUBLIC, anon;
DROP POLICY IF EXISTS pm_bot_config_all ON public.erp_pm_bot_config;
CREATE POLICY pm_bot_config_all ON public.erp_pm_bot_config FOR ALL
  USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin())
  WITH CHECK ((company_id IN (SELECT get_user_company_ids())) OR is_admin());

-- ─────────────────────────────────────────── 2) RPC: ler a config (sem o segredo) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pm_bot_config_obter(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE r public.erp_pm_bot_config%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  PERFORM public.fn__guarda_empresa(p_company_id);
  SELECT * INTO r FROM public.erp_pm_bot_config WHERE company_id = p_company_id;
  IF NOT FOUND THEN
    -- estado honesto: ainda não configurado (RD-98 pilar 1)
    RETURN jsonb_build_object(
      'conectado', false, 'canal_nome', NULL,
      'eventos', jsonb_build_object('novo_job', true, 'aprovacao_pendente', true, 'prazo_24h', true,
                                    'job_atrasado', true, 'estouro_horas', true),
      'conectado_em', NULL);
  END IF;
  RETURN jsonb_build_object(
    'conectado', r.conectado, 'canal_nome', r.canal_nome, 'eventos', r.eventos,
    'conectado_em', r.conectado_em);
END;
$f$;
REVOKE ALL ON FUNCTION public.fn_pm_bot_config_obter(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_bot_config_obter(uuid) TO authenticated, service_role;

-- ─────────────────────────────────── 3) RPC: conectar (grava o webhook NO COFRE) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pm_bot_conectar(
  p_company_id uuid, p_webhook text, p_canal_nome text DEFAULT NULL, p_eventos jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault', 'pg_temp'
AS $f$
DECLARE
  v_nome text;
  v_sid  uuid;
  v_eventos jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  PERFORM public.fn__guarda_empresa(p_company_id);

  p_webhook := btrim(coalesce(p_webhook, ''));
  -- o Incoming Webhook do Slack é sempre https://hooks.slack.com/...
  IF p_webhook = '' OR p_webhook !~* '^https://hooks\.slack\.com/' THEN
    RETURN jsonb_build_object('ok', false, 'erro',
      'Cole o endereço do webhook do canal (começa com https://hooks.slack.com/...).');
  END IF;

  v_eventos := COALESCE(p_eventos, jsonb_build_object(
    'novo_job', true, 'aprovacao_pendente', true, 'prazo_24h', true, 'job_atrasado', true, 'estouro_horas', true));
  v_nome := 'pm_bot_slack_webhook:' || p_company_id::text;

  -- segredo no cofre (upsert por nome) — o valor NUNCA sai daqui para tabela/log
  SELECT id INTO v_sid FROM vault.secrets WHERE name = v_nome;
  IF v_sid IS NULL THEN
    PERFORM vault.create_secret(p_webhook, v_nome, 'P&M bot Slack webhook da empresa ' || p_company_id::text);
  ELSE
    PERFORM vault.update_secret(v_sid, p_webhook);
  END IF;

  INSERT INTO public.erp_pm_bot_config
    (company_id, canal_nome, conectado, nome_secret_vault, eventos, conectado_em, conectado_por, atualizado_em, atualizado_por)
  VALUES
    (p_company_id, NULLIF(btrim(coalesce(p_canal_nome, '')), ''), true, v_nome, v_eventos, now(), auth.uid(), now(), auth.uid())
  ON CONFLICT (company_id) DO UPDATE
    SET canal_nome = EXCLUDED.canal_nome,
        conectado = true,
        nome_secret_vault = EXCLUDED.nome_secret_vault,
        eventos = EXCLUDED.eventos,
        conectado_em = now(),
        conectado_por = auth.uid(),
        atualizado_em = now(),
        atualizado_por = auth.uid();

  -- auditoria SEM o valor do webhook
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (p_company_id, auth.uid(), 'erp_pm_bot_config', p_company_id::text, 'conectar',
            NULL, jsonb_build_object('canal_nome', NULLIF(btrim(coalesce(p_canal_nome, '')), ''), 'eventos', v_eventos));

  RETURN jsonb_build_object('ok', true, 'conectado', true);
END;
$f$;
REVOKE ALL ON FUNCTION public.fn_pm_bot_conectar(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_bot_conectar(uuid, text, text, jsonb) TO authenticated, service_role;

-- ───────────────────────────────────────── 4) RPC: salvar quais eventos avisar ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pm_bot_eventos_salvar(p_company_id uuid, p_eventos jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE v_ant jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF p_eventos IS NULL OR jsonb_typeof(p_eventos) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Escolha ao menos um evento para receber.');
  END IF;

  SELECT eventos INTO v_ant FROM public.erp_pm_bot_config WHERE company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Conecte um canal do Slack antes de escolher os avisos.');
  END IF;

  UPDATE public.erp_pm_bot_config
     SET eventos = jsonb_build_object(
           'novo_job',           coalesce((p_eventos->>'novo_job')::boolean, false),
           'aprovacao_pendente', coalesce((p_eventos->>'aprovacao_pendente')::boolean, false),
           'prazo_24h',          coalesce((p_eventos->>'prazo_24h')::boolean, false),
           'job_atrasado',       coalesce((p_eventos->>'job_atrasado')::boolean, false),
           'estouro_horas',      coalesce((p_eventos->>'estouro_horas')::boolean, false)),
         atualizado_em = now(), atualizado_por = auth.uid()
   WHERE company_id = p_company_id;

  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (p_company_id, auth.uid(), 'erp_pm_bot_config', p_company_id::text, 'eventos',
            jsonb_build_object('eventos', v_ant), jsonb_build_object('eventos', p_eventos));

  RETURN jsonb_build_object('ok', true);
END;
$f$;
REVOKE ALL ON FUNCTION public.fn_pm_bot_eventos_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_bot_eventos_salvar(uuid, jsonb) TO authenticated, service_role;

-- ────────────────────────────── 5) RPC: desconectar (remove o segredo do cofre) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pm_bot_desconectar(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault', 'pg_temp'
AS $f$
DECLARE v_nome text; v_sid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  PERFORM public.fn__guarda_empresa(p_company_id);

  SELECT nome_secret_vault INTO v_nome FROM public.erp_pm_bot_config WHERE company_id = p_company_id;
  IF v_nome IS NOT NULL THEN
    SELECT id INTO v_sid FROM vault.secrets WHERE name = v_nome;
    IF v_sid IS NOT NULL THEN DELETE FROM vault.secrets WHERE id = v_sid; END IF;
  END IF;

  UPDATE public.erp_pm_bot_config
     SET conectado = false, nome_secret_vault = NULL, canal_nome = NULL,
         atualizado_em = now(), atualizado_por = auth.uid()
   WHERE company_id = p_company_id;

  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (p_company_id, auth.uid(), 'erp_pm_bot_config', p_company_id::text, 'desconectar', NULL, NULL);

  RETURN jsonb_build_object('ok', true, 'conectado', false);
END;
$f$;
REVOKE ALL ON FUNCTION public.fn_pm_bot_desconectar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_bot_desconectar(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────── 6) Ajuda de campo (RD-95 "?") ─────────────────────────────────────────
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status) VALUES
 ('pm.bot.tela','/dashboard/pm/bot','Bot no Slack','Bot no Slack',
  'Conecte um canal do Slack da agência para receber os avisos do sistema por mensagem, sem precisar abrir o ERP.',
  'Leva os alertas de job, aprovação e prazo para onde a equipe já conversa — menos fricção, nada esquecido.',
  'Conecte o canal #jobs e passe a receber "novo job" e "prazo em 24h" direto no Slack.',
  'Achar que precisa do WhatsApp agora: a V1 é no Slack (gratuito); WhatsApp vem depois.','pm',1,'publicado'),
 ('pm.bot.canal_nome','/dashboard/pm/bot','Bot no Slack','Nome do canal',
  'Um apelido para você lembrar qual canal recebe os avisos (ex.: "#jobs-agencia"). É só exibição.',
  'Mostra na tela para qual canal os avisos vão, sem precisar abrir o Slack para conferir.',
  '#jobs-agencia',
  'Confundir com o endereço do webhook: o apelido é só um nome amigável.','pm',2,'publicado'),
 ('pm.bot.webhook','/dashboard/pm/bot','Bot no Slack','Endereço do webhook',
  'Cole o endereço do "Incoming Webhook" do canal no Slack (começa com https://hooks.slack.com/...). Ele é guardado em cofre, nunca aparece de novo.',
  'É por esse endereço que o sistema posta a mensagem no seu canal. Fica criptografado no cofre, nunca em texto.',
  'https://hooks.slack.com/services/T000/B000/XXXX',
  'Colar o link do canal em vez do webhook: o webhook é criado em Slack › Apps › Incoming Webhooks.','pm',3,'publicado'),
 ('pm.bot.conectar','/dashboard/pm/bot','Bot no Slack','Conectar canal',
  'Toque para guardar o webhook no cofre e começar a receber os avisos escolhidos.',
  'Liga o bot: a partir daqui os eventos marcados viram mensagem no canal.',
  'Colou o webhook e marcou os avisos: toque em Conectar.',
  'Conectar sem marcar nenhum aviso: escolha ao menos um evento.','pm',4,'publicado'),
 ('pm.bot.desconectar','/dashboard/pm/bot','Bot no Slack','Desconectar',
  'Remove o webhook do cofre e para de enviar avisos a este canal.',
  'Desliga o bot com segurança: o segredo é apagado do cofre.',
  'Trocou de canal ou saiu do Slack: desconecte para não vazar avisos.',
  'Achar que só desmarcar os eventos desconecta: o webhook só sai do cofre ao Desconectar.','pm',5,'publicado'),
 ('pm.bot.ev_novo_job','/dashboard/pm/bot','Bot no Slack','Novo job',
  'Receber um aviso quando um novo job for criado na agência.',
  'A equipe fica sabendo na hora que entrou trabalho novo.',
  'Entrou "Campanha de Natal": chega a mensagem no canal.',
  'Esperar aviso de job sem ter conectado o canal antes.','pm',6,'publicado'),
 ('pm.bot.ev_aprovacao_pendente','/dashboard/pm/bot','Bot no Slack','Aprovação pendente do cliente',
  'Receber um aviso quando uma arte/entrega estiver esperando a aprovação do cliente.',
  'Ninguém esquece de cobrar o cliente: o aviso aparece enquanto a aprovação não vem.',
  '"Arte do post aguardando aprovação há 2 dias."',
  'Confundir com aprovação interna: aqui é a aprovação do cliente.','pm',7,'publicado'),
 ('pm.bot.ev_prazo_24h','/dashboard/pm/bot','Bot no Slack','Prazo vencendo em 24h',
  'Receber um aviso quando um job tiver prazo para as próximas 24 horas.',
  'Dá tempo de reagir antes de estourar: o lembrete chega um dia antes.',
  '"Job Boticário vence amanhã às 18h."',
  'Achar que avisa no dia: o aviso é 24h antes do prazo.','pm',8,'publicado'),
 ('pm.bot.ev_job_atrasado','/dashboard/pm/bot','Bot no Slack','Job atrasado',
  'Receber um aviso quando um job passar do prazo sem ser concluído.',
  'O atraso não fica escondido: o canal recebe o alerta para a equipe agir.',
  '"Job Natura está 1 dia atrasado."',
  'Confundir com "prazo em 24h": aqui o prazo já passou.','pm',9,'publicado'),
 ('pm.bot.ev_estouro_horas','/dashboard/pm/bot','Bot no Slack','Estouro de horas do contrato',
  'Receber um aviso quando as horas apontadas passarem (ou estiverem perto de passar) das horas previstas no contrato.',
  'Protege a margem: avisa antes de trabalhar de graça acima do contratado.',
  '"Contrato do cliente X já usou 92% das horas do mês."',
  'Esperar o aviso sem apontar horas: o cálculo vem do apontamento da equipe.','pm',10,'publicado'),
 ('pm.bot.status','/dashboard/pm/bot','Bot no Slack','Situação do bot',
  'Mostra se o canal está conectado e desde quando.',
  'De relance você sabe se os avisos estão indo para o Slack.',
  'Conectado desde 04/11: os avisos estão ativos.',
  'Achar que está enviando sem estar conectado: confira a situação aqui.','pm',11,'publicado'),
 ('pm.bot.proximo','/dashboard/pm/bot','Bot no Slack','O que vem a seguir',
  'Depois de conectar, o envio automático e o histórico das mensagens entram na próxima fatia (motor de envio).',
  'Deixa claro o que já funciona (conectar e escolher avisos) e o que chega em seguida.',
  'Conectou o canal: os avisos passam a sair quando o motor de envio for publicado.',
  'Esperar a mensagem de teste agora: o envio chega na próxima fatia.','pm',12,'publicado')
ON CONFLICT (chave) DO NOTHING;

-- ───────────────────────────────── 7) Origem do dado (RD-98 p3): system_screens ────────────────────────────────────
UPDATE system_screens
   SET descricao_funcional = 'P&M · Bot no Slack (V1 notificações): conecta um canal do Slack por webhook (guardado no cofre) e escolhe quais avisos receber (novo job, aprovação pendente, prazo em 24h, job atrasado, estouro de horas). Envio e histórico na fatia seguinte.',
       views_consumidas = ARRAY['erp_pm_bot_config']::text[],
       rpcs_chamadas = ARRAY['fn_pm_bot_config_obter','fn_pm_bot_conectar','fn_pm_bot_eventos_salvar','fn_pm_bot_desconectar']::text[]
 WHERE rota = '/dashboard/pm/bot';

-- ───────────────────────────────────── 8) Seed DEMO (Agência P&M - DEMO) ───────────────────────────────────────────
-- Mostra a tela no estado CONECTADO para a DEMO poder navegar o fluxo inteiro. O valor no cofre é um placeholder de
-- demonstração (a fatia de envio não existe ainda, então nada é postado). Idempotente.
DO $seed$
DECLARE
  v_company uuid := 'b0700000-0000-4000-a000-000000000002';  -- Agência (P&M) - DEMO
  v_nome text := 'pm_bot_slack_webhook:b0700000-0000-4000-a000-000000000002';
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = v_company) THEN
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = v_nome) THEN
      PERFORM vault.create_secret('https://hooks.slack.com/services/DEMO/DEMO/demonstracao', v_nome, 'DEMO P&M bot Slack webhook (placeholder)');
    END IF;
    INSERT INTO public.erp_pm_bot_config
      (company_id, canal_nome, conectado, nome_secret_vault, eventos, conectado_em, atualizado_em)
    VALUES
      (v_company, '#jobs-agencia', true, v_nome,
       jsonb_build_object('novo_job', true, 'aprovacao_pendente', true, 'prazo_24h', true, 'job_atrasado', false, 'estouro_horas', true),
       now(), now())
    ON CONFLICT (company_id) DO NOTHING;
  END IF;
END
$seed$;
