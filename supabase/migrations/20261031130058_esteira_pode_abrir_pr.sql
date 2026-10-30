-- Esteira: remover o TETO de PRs prontas (CEO 30/10). Devs passam a abrir PR sem limite de prontas;
-- a contagem fica só informativa. Mantém a assinatura e os parâmetros (compatibilidade com quem já chama),
-- e a função continua trancada (service_role; sem anon). Não é SECURITY DEFINER (roda com o privilégio do chamador).
CREATE OR REPLACE FUNCTION public.fn_esteira_pode_abrir_pr(
  p_agente text, p_urgente boolean DEFAULT false, p_correcao_esteira boolean DEFAULT false
) RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  WITH ciclo AS (
    SELECT pr_numero,
           bool_or(evento = 'pronta') AS pronta,
           bool_or(evento IN ('publicada','fechada')) AS fim
      FROM erp_dev_entrega
     WHERE ocorrido_em > now() - interval '3 days'
     GROUP BY pr_numero
  ), n AS (SELECT count(*)::int AS prontas FROM ciclo WHERE pronta AND NOT fim)
  SELECT jsonb_build_object(
    'ok', true,
    'agente', p_agente,
    'prontas', n.prontas,
    'limite', null,
    'pode', true,                         -- SEM TETO (CEO 30/10): sempre pode abrir
    'motivo', 'sem teto de prontas (CEO 30/10) — ' || n.prontas || ' prontas na fila'
  ) FROM n;
$function$;
REVOKE ALL ON FUNCTION public.fn_esteira_pode_abrir_pr(text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_esteira_pode_abrir_pr(text, boolean, boolean) TO service_role;
