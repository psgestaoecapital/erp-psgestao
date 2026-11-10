-- Chamado #7050 · Fase 1 (decisão da Jordana 09/11): desligar os caminhos automáticos que escrevem para o cliente.
-- Desliga SEM apagar nada: funções e histórico ficam; só o agendamento (pg_cron) fica inativo. Reversível:
--   SELECT cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = '<nome>'), active := true);
-- Não altera nenhum chamado (os já concluídos automaticamente continuam como estão).
-- Mantidos de propósito: sugestao-email-fila-1min (só envia a resposta que o OPERADOR aprovou, tipo 'resposta'),
-- aviso ao responsável ao abrir o chamado, análise de IA de anexos, caminho do Code (exige OK),
-- vigia-coleta-agentes (só abre/atualiza chamado INTERNO da empresa PS, o cliente não vê).
DO $$
DECLARE v_nome text;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN RETURN; END IF;
  FOREACH v_nome IN ARRAY ARRAY['sugestao-confirmacao-automatica','sugestao-lembrete-confirmacao-diario'] LOOP
    PERFORM cron.alter_job(job_id := j.jobid, active := false) FROM cron.job j WHERE j.jobname = v_nome;
  END LOOP;
END $$;

-- Rede de segurança: mesmo chamada à mão ou religada por engano, a função não conclui nem escreve ao cliente.
CREATE OR REPLACE FUNCTION public.fn_sugestao_confirmacao_automatica(p_hoje date DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo'::text))::date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN jsonb_build_object('ok', true, 'pulou', 'desligado_chamado_7050');
END $function$;

CREATE OR REPLACE FUNCTION public.fn_sugestao_lembrete_confirmacao()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN jsonb_build_object('ok', true, 'pulou', 'desligado_chamado_7050');
END $function$;

-- ACL preservada (só dono + service_role; chamadas apenas pelo pg_cron). Não abrir para anon/authenticated.
REVOKE ALL ON FUNCTION public.fn_sugestao_confirmacao_automatica(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_sugestao_lembrete_confirmacao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_confirmacao_automatica(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_lembrete_confirmacao() TO service_role;
