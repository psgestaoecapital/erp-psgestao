-- ============================================================================
-- Migration: relig_resumo_atak_cron
-- Objetivo : religar o refresh de ind_atak_dominio_resumo (congelado desde 10/08)
-- Natureza : ADITIVA — só reconstrói agregação derivada a partir do fato bruto.
--            NÃO toca nenhuma tabela de domínio financeiro/fiscal/estoque.
--            RD-54/55 seguro: nada de cliente é apagado; o resumo é 100% derivável.
--
-- Diagnóstico (auditado 18/08 20:29 UTC): ind_atak_fato VIVO (12 domínios, último import ~min atrás),
-- mas ind_atak_dominio_resumo CONGELADO (max atualizado_em=10/08, 11 domínios). Causa: fn_ind_atak_resumo_refresh
-- existe e está correta, mas órfã (sem trigger/cron) e com guard get_user_company_ids() que barra o cron.
-- Fix: wrapper backend-only SEM guard interativo + backfill + cron. Consome: fn_bi_temas_industrial (grade de
-- domínios do BI industrial). O BI Comercial (fn_bi_comercial_*) lê o fato RAW, então não depende deste resumo.
-- ============================================================================

-- 1) Wrapper multi-tenant SEM guard de usuário (uso EXCLUSIVO backend/cron)
CREATE OR REPLACE FUNCTION public.fn_ind_atak_resumo_refresh_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_linhas   int := 0;
  v_empresas int := 0;
begin
  -- rebuild total: tabela é minúscula (~dezenas de linhas). Atômico dentro da função:
  -- leitores concorrentes veem o estado anterior até o COMMIT (MVCC), nunca vazio.
  delete from ind_atak_dominio_resumo;

  insert into ind_atak_dominio_resumo
    (company_id, dominio, linhas, tem_dado, ultimo_import, atualizado_em)
  select company_id,
         dominio,
         count(*),
         count(*) > 0,
         max(imported_at),
         now()                 -- frescor honesto explícito (RD-52/58)
    from ind_atak_fato
   group by company_id, dominio;
  get diagnostics v_linhas = row_count;

  select count(distinct company_id) into v_empresas from ind_atak_fato;

  return jsonb_build_object(
    'ok', true,
    'empresas', v_empresas,
    'linhas_resumo', v_linhas,
    'em', now()
  );
end
$function$;

-- Backend-only: usuários finais nunca chamam este wrapper (o RPC com guard continua existindo p/ uso interativo)
REVOKE ALL ON FUNCTION public.fn_ind_atak_resumo_refresh_all() FROM public;
REVOKE ALL ON FUNCTION public.fn_ind_atak_resumo_refresh_all() FROM anon;
REVOKE ALL ON FUNCTION public.fn_ind_atak_resumo_refresh_all() FROM authenticated;

-- 2) BACKFILL IMEDIATO — descongela Frioeste (e qualquer tenant) na hora do apply
SELECT public.fn_ind_atak_resumo_refresh_all();

-- 3) Agendamento pg_cron a cada 30 min (autorizado no SPEC pelo CEO).
--    Guardado: se pg_cron não existir, não derruba a migration (o wrapper + backfill já valem).
--    cron.schedule faz upsert pelo jobname → idempotente em re-deploy.
DO $mig$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('atak-resumo-refresh-30min', '*/30 * * * *',
                          'SELECT public.fn_ind_atak_resumo_refresh_all();');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron atak-resumo-refresh-30min nao agendado (%). Agende manualmente se necessario.', SQLERRM;
END $mig$;
