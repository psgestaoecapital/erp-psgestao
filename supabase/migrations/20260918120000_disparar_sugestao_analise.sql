-- IA dos chamados — disparo server-side da análise (RD-38 / #90).
--
-- Contexto: a edge sugestao-analisar analisa a foto do chamado/mensagem. O disparo vinha só do
-- NAVEGADOR (supabase.functions.invoke) — se ninguém abrisse o chamado no lado do suporte, o print
-- nunca era lido (foi o caso do print das 16:14 do Rodrigo no #90). Esta RPC permite disparar a
-- análise DO SERVIDOR (auditoria, backfill, cron), sem depender de uma aba aberta no navegador.
--
-- A edge agora aceita o header x-watcher-secret (verify_jwt=false) exatamente para este disparo por
-- net.http_post. O segredo é o mesmo do insight-auditor. pg_net não espera a resposta (timeout de 5s),
-- mas a função continua rodando no servidor e grava ia_analise ao terminar.
CREATE OR REPLACE FUNCTION public.fn_disparar_sugestao_analise(p_mensagem_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req_id bigint;
BEGIN
  SELECT net.http_post(
    url     := 'https://horsymhsinqcimflrtjo.supabase.co/functions/v1/sugestao-analisar',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-watcher-secret', 'ps-watcher-2026-9k2mxqp4nv8wzr7y6h3t'
               ),
    body    := jsonb_build_object('mensagem_id', p_mensagem_id)
  ) INTO v_req_id;
  RETURN v_req_id;
END
$function$;

COMMENT ON FUNCTION public.fn_disparar_sugestao_analise(uuid)
  IS 'Dispara a análise de IA de uma mensagem de chamado do servidor (net.http_post → edge sugestao-analisar com x-watcher-secret). Usada por backfill/auditoria quando o navegador não abriu o chamado.';
