-- Painel de Codes (CEO 16/10): cartão "Code-Auditor" (identificador interno continua eng-chefe-auto).
-- Função NOVA, só leitura, agregada: o que o auditor de plantão fez HOJE (dia de São Paulo). gold_veredito_triplo não tem
-- policy de leitura para o navegador, então a tela lê por aqui, guardada por fn_dev_painel_pode_ver (equipe PS ativa).
-- Aditiva: nada existente é alterado. Plano de volta: DROP FUNCTION public.fn_dev_auditor_resumo().
CREATE OR REPLACE FUNCTION public.fn_dev_auditor_resumo() RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_ini timestamptz := (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')) AT TIME ZONE 'America/Sao_Paulo';
  v_res jsonb;
BEGIN
  IF NOT public.fn_dev_painel_pode_ver() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  SELECT jsonb_build_object(
    'ok', true,
    'prs_hoje', (SELECT count(DISTINCT pr_numero) FROM gold_veredito_triplo WHERE executado_em >= v_ini AND pr_numero IS NOT NULL),
    'telas_hoje', (SELECT count(DISTINCT s) FROM (
        SELECT screen_id AS s FROM gold_veredito_triplo WHERE executado_em >= v_ini
        UNION SELECT screen_id FROM system_screens_insights WHERE analisado_em >= v_ini) x),
    'vereditos', COALESCE((SELECT jsonb_object_agg(v, n) FROM (
        SELECT COALESCE(veredito_final, 'PENDENTE') AS v, count(*) AS n FROM gold_veredito_triplo
        WHERE executado_em >= v_ini GROUP BY 1) y), '{}'::jsonb),
    'ultimo', (SELECT jsonb_build_object('quando', quando, 'rota', rota, 'screen_id', screen_id) FROM (
        SELECT executado_em AS quando, rota, screen_id FROM gold_veredito_triplo
        UNION ALL SELECT analisado_em, rota, screen_id FROM system_screens_insights
        ORDER BY 1 DESC NULLS LAST LIMIT 1) z)
  ) INTO v_res;
  RETURN v_res;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_dev_auditor_resumo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dev_auditor_resumo() TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_dev_auditor_resumo() IS
  'Resumo do dia do Code-Auditor (eng-chefe-auto) para o Painel de Codes: PRs/telas auditadas hoje, vereditos e a última auditoria. Só equipe PS.';
