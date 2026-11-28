-- conserto-main (P0 · banco travado 28/11 02:08–08:36 BRT): o banco de produção ficou sem responder ~6h30.
-- Sinais (pg_stat_statements + logs): o disco estava saturado — um checkpoint de 1.176 buffers levou 270 s às 02:04 —
-- e os maiores consumidores de leitura de disco eram refreshes que relêem a tabela ind_atak_fato (1,3 GB, jsonb) INTEIRA:
--   1) fn_ind_atak_resumo_refresh_all (cron 49, a cada 30 min): 59 mi de blocos lidos, ~20 s por rodada. Redundante —
--      o resumo por empresa/domínio JÁ é mantido incrementalmente pelos triggers trg_atak_resumo_fato_* em
--      ind_atak_status_resumo.
--   2) fn_bi_comercial_item_refresh (cron 103, a cada 30 min, NO MESMO MINUTO do 49): 17 mi de blocos, ~27 s, roda
--      mesmo sem venda nova.
--   3) fn_ind_fin_titulo_mv_refresh (chamado pela ingestão do ATAK a CADA lote do financeiro, #6311): 1.125 chamadas,
--      ~3,7 s cada.
-- Correção (sem mudar número nenhum das telas):
--   a) fn_ind_fin_titulo_mv_refresh passa a ter TRAVA DE FREQUÊNCIA: se a MV foi atualizada há menos de 15 min, só marca
--      "pendente" e volta (a ingestão segue chamando; o custo vira ~0).
--   b) fn_atak_refresh_pendentes(): roda a cada 15 min e só atualiza o que MUDOU desde o último refresh, pelo sinal barato
--      ind_atak_status_resumo.atualizado_em (mantido pelos triggers): financeiro → MV de títulos; comercial_venda_item /
--      comercial_devolucao → MVs do BI comercial. Sem dado novo, não lê ind_atak_fato.
--   c) O rebuild total do resumo (fn_ind_atak_resumo_refresh_all) vira rede de segurança 1×/dia (03:10 BRT).
--   d) cron 49 (atak-resumo-refresh-30min) passa a chamar fn_atak_refresh_pendentes a cada 15 min; cron 103
--      (bi_comercial_item_refresh) sai — o trabalho dele está dentro do (b).

ALTER TABLE public.ind_fin_titulo_mv_meta ADD COLUMN IF NOT EXISTS pendente boolean NOT NULL DEFAULT false;

-- (a) trava de frequência no refresh chamado pela ingestão
CREATE OR REPLACE FUNCTION public.fn_ind_fin_titulo_mv_refresh()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n bigint;
  v_ult timestamptz;
BEGIN
  SELECT atualizado_em INTO v_ult FROM public.ind_fin_titulo_mv_meta WHERE id LIMIT 1;
  IF v_ult IS NOT NULL AND v_ult > now() - interval '15 minutes' THEN
    UPDATE public.ind_fin_titulo_mv_meta SET pendente = true WHERE id;
    RETURN jsonb_build_object('ok', true, 'adiado', true, 'atualizado_em', v_ult);
  END IF;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.ind_fin_titulo_mv;
  SELECT count(*) INTO v_n FROM public.ind_fin_titulo_mv;
  UPDATE public.ind_fin_titulo_mv_meta SET atualizado_em = now(), linhas = v_n, pendente = false WHERE id;
  RETURN jsonb_build_object('ok', true, 'linhas', v_n, 'atualizado_em', now());
END
$function$;
REVOKE ALL ON FUNCTION public.fn_ind_fin_titulo_mv_refresh() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ind_fin_titulo_mv_refresh() TO authenticated, service_role;

-- (b) refresh sob demanda: só o que mudou
CREATE OR REPLACE FUNCTION public.fn_atak_refresh_pendentes()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fin_ult timestamptz;
  v_fin_pend boolean;
  v_com_ult timestamptz;
  v_fin text := 'sem_novidade';
  v_com text := 'sem_novidade';
  v_res text := 'nao_e_hora';
  v_agora_brt timestamp := (now() AT TIME ZONE 'America/Sao_Paulo');
BEGIN
  -- financeiro → MV dos títulos (BI Financeiro da Diretoria)
  SELECT atualizado_em, pendente INTO v_fin_ult, v_fin_pend FROM public.ind_fin_titulo_mv_meta WHERE id LIMIT 1;
  IF COALESCE(v_fin_pend, false)
     OR v_fin_ult IS NULL
     OR EXISTS (SELECT 1 FROM public.ind_atak_status_resumo
                 WHERE dominio IN ('financeiro_pagar','financeiro_receber') AND atualizado_em > v_fin_ult) THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.ind_fin_titulo_mv;
    UPDATE public.ind_fin_titulo_mv_meta
       SET atualizado_em = now(), linhas = (SELECT count(*) FROM public.ind_fin_titulo_mv), pendente = false
     WHERE id;
    v_fin := 'atualizado';
  END IF;

  -- comercial → MVs do BI comercial
  SELECT max(atualizado_em) INTO v_com_ult FROM public.bi_comercial_item_status;
  IF v_com_ult IS NULL
     OR EXISTS (SELECT 1 FROM public.ind_atak_status_resumo
                 WHERE dominio IN ('comercial_venda_item','comercial_devolucao') AND atualizado_em > v_com_ult) THEN
    PERFORM public.fn_bi_comercial_item_refresh();
    v_com := 'atualizado';
  END IF;

  -- rede de segurança: rebuild total do resumo 1×/dia (03:10–03:24 BRT)
  IF extract(hour FROM v_agora_brt) = 3 AND extract(minute FROM v_agora_brt) BETWEEN 10 AND 24 THEN
    PERFORM public.fn_ind_atak_resumo_refresh_all();
    v_res := 'rebuild_diario';
  END IF;

  RETURN jsonb_build_object('ok', true, 'financeiro', v_fin, 'comercial', v_com, 'resumo', v_res, 'em', now());
END
$function$;
REVOKE ALL ON FUNCTION public.fn_atak_refresh_pendentes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_atak_refresh_pendentes() TO service_role;

-- (d) agenda: o 49 passa a rodar o sob-demanda a cada 15 min (minutos 10/25/40/55, fora do pico :00/:30); o 103 sai.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'atak-resumo-refresh-30min') THEN
    PERFORM cron.unschedule('atak-resumo-refresh-30min');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bi_comercial_item_refresh') THEN
    PERFORM cron.unschedule('bi_comercial_item_refresh');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'atak-refresh-pendentes-15min') THEN
    PERFORM cron.unschedule('atak-refresh-pendentes-15min');
  END IF;
END $$;
SELECT cron.schedule('atak-refresh-pendentes-15min', '10,25,40,55 * * * *', $cron$ SELECT public.fn_atak_refresh_pendentes(); $cron$);
