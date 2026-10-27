-- Vigia da frota (CEO 22/10, "Aprovado") — detecta token de rotina REVOGADO e alerta na hora.
--
-- Por que existe: em 22/10 a frota ficou "dias sem publicar" porque 3 Codes (desenv, revisor, produto)
-- estavam com o token OAuth das rotinas REVOGADO (HTTP 401 "OAuth access token has been revoked") —
-- resquício da recriação das rotinas em 21/10, com o cofre guardando o token velho. O despertador
-- disparava certo, a Anthropic recusava o POST, e nenhuma sessão começava. Descobrimos só na mão,
-- lendo net._http_response. Este vigia transforma esse diagnóstico de meia-manhã num alerta imediato.
--
-- O que faz: para cada rotina que aciona, olha a resposta HTTP mais recente do acionamento. Se for 401
-- (token revogado), grava UM alerta crítico por agente a cada 12 h em erp_contexto_projeto — o mesmo
-- canal que o briefing lê em `alertas_pendentes_para_ceo`. Não dispara rotina, não chama net.http_post:
-- é puro monitor (leitura + alerta), sem custo de crédito. Roda de hora em hora.

CREATE OR REPLACE FUNCTION public.fn_vigia_frota(p_simular boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; v_alertas jsonb := '[]'::jsonb; v_n int := 0; v_extra text;
BEGIN
  PERFORM public.fn__agente_assert_servico();

  FOR r IN
    SELECT ro.agente,
           (SELECT resp.status_code
              FROM erp_agente_mensagem m
              JOIN net._http_response resp ON resp.id = (m.acionamento->>'request_id')::bigint
             WHERE m.para = ro.agente AND m.acionamento->>'acionou' = 'true'
             ORDER BY (m.acionamento->>'em')::timestamptz DESC
             LIMIT 1) AS ult_status
      FROM erp_agente_rotina ro
     WHERE ro.aciona
  LOOP
    CONTINUE WHEN r.ult_status IS DISTINCT FROM 401;   -- só token revogado

    -- dedup: no máximo um alerta por agente a cada 12 h
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM erp_contexto_projeto
       WHERE projeto = 'agentes_caixa' AND criado_por = 'vigia_frota'
         AND refs->>'agente' = r.agente AND criado_em > now() - interval '12 hours');

    v_n := v_n + 1;
    v_alertas := v_alertas || jsonb_build_array(jsonb_build_object('agente', r.agente, 'http', r.ult_status));
    CONTINUE WHEN p_simular;

    -- o revisor tem a camada extra do segredo do GitHub (acionar-revisor.yml), além do cofre
    v_extra := CASE WHEN r.agente = 'gilberto-revisor'
                    THEN ' Como é o revisor, atualize TAMBÉM os segredos do GitHub REVISOR_ROTINA_URL/REVISOR_ROTINA_TOKEN (o acionar-revisor.yml usa eles, não o cofre).'
                    ELSE '' END;

    INSERT INTO erp_contexto_projeto (projeto, categoria, prioridade, titulo, descricao, refs, criado_por, tags)
    VALUES ('agentes_caixa', 'pendencia', 'critica',
            'TOKEN REVOGADO: a rotina ' || r.agente || ' está recusando acionamento (HTTP 401)',
            'O vigia da frota detectou que a rotina do Code ' || r.agente || ' está com o token OAuth REVOGADO '
            || '(HTTP 401 "OAuth access token has been revoked"): ela NÃO acorda e as tarefas ficam paradas na caixa. '
            || 'Conserto (2 min): reautorizar/recriar a rotina no Claude Code e atualizar o Vault do Supabase '
            || '(agente_rotina_url_' || r.agente || ' e agente_rotina_token_' || r.agente || ').' || v_extra,
            jsonb_build_object('agente', r.agente, 'http', r.ult_status),
            'vigia_frota', ARRAY['alerta', 'vigia', 'token_revogado']);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'alertas_novos', v_n, 'detalhe', v_alertas);
END;
$function$;

-- Grants restritos (lição da revisão da #2970): a função nova não nasce aberta para PUBLIC.
REVOKE ALL ON FUNCTION public.fn_vigia_frota(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_vigia_frota(boolean) TO service_role;

-- Cron de hora em hora: puro monitor (sem acordar rotina, sem http_post → sem custo de crédito).
-- Idempotente (cron.schedule faz upsert pelo nome do job).
SELECT cron.schedule('vigia-frota-token-1h', '15 * * * *', $cron$SELECT public.fn_vigia_frota();$cron$);
