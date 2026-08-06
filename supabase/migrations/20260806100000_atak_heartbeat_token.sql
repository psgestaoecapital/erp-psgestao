-- RD-41 · ATAK Produtização Peça 2 · FIX5 — heartbeat REAL por empresa (semáforo do monitor).
-- Hoje o heartbeat só existe na edge atak-ingest com company_id FIXO (Frioeste). Para o onboarding
-- self-service de um NOVO frigorífico, o Agente PS reporta o heartbeat via ESTE RPC, autenticado pelo
-- agente_token (identidade do agente, gerada no cadastro). Resolve a empresa pelo token e grava em
-- erp_sync_log (trigger_type='coletor_atak') — o mesmo que fn_atak_conexao_listar já lê pro semáforo.
-- Não toca o pipeline de dados (RD-53: abate sagrado): é só telemetria de saúde.
--
-- Pilar 2: só o TOKEN trafega (a senha do SQL fica local, no .env do TI). Token inválido → sem gravação.
CREATE OR REPLACE FUNCTION public.fn_atak_heartbeat(
  p_token text,
  p_fase text DEFAULT 'sucesso',
  p_host text DEFAULT NULL,
  p_versao text DEFAULT NULL,
  p_dominio text DEFAULT NULL,
  p_gravados integer DEFAULT NULL,
  p_duracao_ms integer DEFAULT NULL,
  p_erro text DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_company uuid; v_fase text;
BEGIN
  IF p_token IS NULL OR length(btrim(p_token)) < 8 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'token_invalido');
  END IF;
  SELECT company_id INTO v_company FROM public.atak_conexao_config WHERE agente_token = p_token;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'token_nao_encontrado');
  END IF;

  v_fase := CASE WHEN p_fase IN ('iniciando','sucesso','falha','timeout') THEN p_fase ELSE 'sucesso' END;

  -- duracao_ms é coluna GENERATED (finalizado_em - iniciado_em) — NÃO inserir; guardo o informado no jsonb.
  INSERT INTO public.erp_sync_log (company_id, trigger_type, fase, iniciado_em, finalizado_em, http_response, erro)
  VALUES (
    v_company, 'coletor_atak', v_fase, now(),
    CASE WHEN v_fase IN ('sucesso','falha','timeout') THEN now() ELSE NULL END,
    jsonb_strip_nulls(jsonb_build_object(
      'fonte', 'atak', 'host', p_host, 'collector_version', p_versao, 'dominio', p_dominio,
      'gravados', p_gravados, 'duracao_ms', p_duracao_ms, 'via', 'heartbeat_rpc')),
    p_erro
  );
  RETURN jsonb_build_object('sucesso', true, 'company_id', v_company, 'fase', v_fase);
END; $function$;

-- O Agente PS chama com a anon key (pública) + o token no corpo — igual já faz pra ler o mapa.
GRANT EXECUTE ON FUNCTION public.fn_atak_heartbeat(text,text,text,text,text,integer,integer,text) TO anon, authenticated;
