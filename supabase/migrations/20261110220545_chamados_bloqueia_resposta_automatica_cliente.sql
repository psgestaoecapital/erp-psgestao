-- Chamado #7050 · Fase 1 (CEO 09/11): NENHUMA resposta ao cliente sem humano aprovar.
-- Auditoria dos caminhos que hoje falam com o cliente sem ação humana no momento do envio:
--   1) cron 'sugestao-confirmacao-automatica' (dias úteis 11:15) → fn_sugestao_confirmacao_automatica():
--      grava aviso automático de conclusão em sugestao_mensagem e envia e-mail 'chamado_lembrete'. BLOQUEADO.
--   2) cron 'sugestao-lembrete-confirmacao-diario' (11:00) → fn_sugestao_lembrete_confirmacao():
--      reenvia por e-mail a resposta já aprovada, sem ninguém disparar. Histórico: 3.520 lembretes. BLOQUEADO.
--   3) cron 'sugestao-email-fila-1min' → fn_sugestao_email_fila(): só drena a fila de respostas JÁ APROVADAS
--      (sugestao_notificacao, criada quando um sócio aprova). MANTIDO: é o caminho oficial de envio.
--   4) cron 'vigia-coleta-agentes' → fn_agente_coleta_vigiar(): abre chamado INTERNO (cliente não vê). MANTIDO.
--   5) fn_agente_chamado_responder (Code): exige requer_ok_ceo com ok_ceo_em registrado. MANTIDO (caminho oficial).
--   6) Gatilhos em sugestoes/sugestao_mensagem: só registram aviso interno ao responsável e reabrem aprovação. MANTIDO.
--   Ações humanas (fn_sugestao_responder, fn_sugestao_aprovar_resposta, fn_sugestao_mensagem_enviar,
--   fn_sugestao_confirmar, fn_sugestao_reabrir, fn_sugestao_encerrar_sem_confirmacao, fn_sugestao_desmembrar)
--   não são automáticas: ficam como estão e entram na decisão da Fase 3 (fluxo de status).
--
-- Efeito: desliga só o agendamento dos dois crons. As funções continuam no banco (sem agendamento = sem envio
-- automático). Reversível: recriar o cron com o mesmo comando, se o CEO decidir outra coisa.
-- Sem cron novo, sem frequência nova. Aditiva e idempotente.

DO $bloqueio$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sugestao-confirmacao-automatica') THEN
    PERFORM cron.unschedule('sugestao-confirmacao-automatica');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sugestao-lembrete-confirmacao-diario') THEN
    PERFORM cron.unschedule('sugestao-lembrete-confirmacao-diario');
  END IF;
END
$bloqueio$;
