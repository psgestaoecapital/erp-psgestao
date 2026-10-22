-- #2946 · NF-e presa em "processando": a rotina de segurança (fn_nfe_auto_consultar_pendentes) passa de 15 em 15 min
-- para 2 em 2 min. Sem custo quando não há nota pendente: a função conta as pendentes e sai sem chamar a edge/Focus.
-- A da NFS-e (*/5) fica como está: ela também reconsulta autorizadas sem PDF (48 h), e mais frequência = mais chamadas.
-- Só muda o agendamento; nenhuma função é alterada.
DO $$
DECLARE v_job bigint;
BEGIN
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'nfe-consultar-processando';
  IF v_job IS NOT NULL THEN
    PERFORM cron.alter_job(job_id := v_job, schedule := '*/2 * * * *');
  ELSE
    PERFORM cron.schedule('nfe-consultar-processando', '*/2 * * * *', $c$ SELECT public.fn_nfe_auto_consultar_pendentes(); $c$);
  END IF;
END $$;
