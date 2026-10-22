-- Aba Codes · histórico + snapshot a cada 15 min (CEO 09/10, fatia 1 do painel de desempenho). Faixa 05 (gilberto-produto).
-- Tabela NOVA erp_dev_codes_snapshot (só leitura das fontes: erp_dev_entrega, erp_agente_mensagem, erp_agente_sessao_lease).
-- Gravação só pelo job (service_role); leitura só equipe PS; nada ao anon. main/deploy e tempo do revisor vêm do GitHub:
-- colunas já previstas, preenchidas por job posterior (null enquanto isso).

CREATE TABLE IF NOT EXISTS public.erp_dev_codes_snapshot (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  capturado_em            timestamptz NOT NULL DEFAULT now(),
  prs_prontas             integer     NOT NULL DEFAULT 0,
  publicadas_hora         integer     NOT NULL DEFAULT 0,
  main_estado             text        CHECK (main_estado IN ('verde','vermelho','desconhecido')),
  deploy_estado           text        CHECK (deploy_estado IN ('verde','vermelho','desconhecido')),
  sessoes_abertas         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  mensagens_por_status    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  tempo_medio_pronta_pub_min numeric,
  tempo_ate_autorizacao_min  numeric
);
CREATE INDEX IF NOT EXISTS erp_dev_codes_snapshot_cap_idx ON public.erp_dev_codes_snapshot (capturado_em DESC);
COMMENT ON TABLE public.erp_dev_codes_snapshot IS
  'Histórico do painel de desempenho da aba Codes: um retrato a cada 15 min (fn_dev_codes_snapshot_gravar). Leitura só equipe PS.';

ALTER TABLE public.erp_dev_codes_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_dev_codes_snapshot FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.erp_dev_codes_snapshot TO authenticated;
GRANT ALL ON TABLE public.erp_dev_codes_snapshot TO service_role;
DROP POLICY IF EXISTS erp_dev_codes_snapshot_sel_equipe_ps ON public.erp_dev_codes_snapshot;
CREATE POLICY erp_dev_codes_snapshot_sel_equipe_ps ON public.erp_dev_codes_snapshot
  FOR SELECT TO authenticated USING (public.fn_dev_painel_pode_ver());

CREATE OR REPLACE FUNCTION public.fn_dev_codes_snapshot_gravar() RETURNS bigint
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id bigint;
BEGIN
  INSERT INTO erp_dev_codes_snapshot (prs_prontas, publicadas_hora, sessoes_abertas, mensagens_por_status, tempo_medio_pronta_pub_min)
  SELECT
    (SELECT count(*) FROM (
       SELECT pr_numero FROM erp_dev_entrega WHERE ocorrido_em > now() - interval '60 days'
       GROUP BY pr_numero
       HAVING bool_or(evento = 'pronta') AND NOT bool_or(evento IN ('publicada','fechada'))) p),
    (SELECT count(*) FROM erp_dev_entrega WHERE evento = 'publicada' AND ocorrido_em > now() - interval '1 hour'),
    COALESCE((SELECT jsonb_object_agg(agente, 1) FROM erp_agente_sessao_lease WHERE renovada_em > now() - interval '12 minutes'), '{}'::jsonb),
    COALESCE((SELECT jsonb_object_agg(para, st) FROM (
       SELECT para, jsonb_object_agg(status, n) st FROM (
         SELECT para, status, count(*) n FROM erp_agente_mensagem WHERE NOT COALESCE(arquivada, false) GROUP BY para, status) a
       GROUP BY para) b), '{}'::jsonb),
    (SELECT round((avg(EXTRACT(epoch FROM (pub - pronta)) / 60))::numeric, 1) FROM (
       SELECT min(ocorrido_em) FILTER (WHERE evento = 'pronta') pronta, max(ocorrido_em) FILTER (WHERE evento = 'publicada') pub
       FROM erp_dev_entrega WHERE ocorrido_em > now() - interval '24 hours' GROUP BY pr_numero) t
     WHERE pub IS NOT NULL AND pronta IS NOT NULL AND pub >= pronta)
  RETURNING id INTO v_id;
  DELETE FROM erp_dev_codes_snapshot WHERE capturado_em < now() - interval '90 days';
  RETURN v_id;
END $function$;
REVOKE ALL ON FUNCTION public.fn_dev_codes_snapshot_gravar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_dev_codes_snapshot_gravar() TO service_role;
COMMENT ON FUNCTION public.fn_dev_codes_snapshot_gravar() IS
  'Job de monitoramento (só leitura das fontes): grava 1 retrato do painel da aba Codes e poda >90 dias. Agendado a cada 15 min por pg_cron.';

-- agendamento a cada 15 min (idempotente)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'dev-codes-snapshot-15min';
    PERFORM cron.schedule('dev-codes-snapshot-15min', '*/15 * * * *', 'SELECT public.fn_dev_codes_snapshot_gravar()');
  END IF;
END $$;
