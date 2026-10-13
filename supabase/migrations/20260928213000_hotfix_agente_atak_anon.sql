-- 🚑 HOTFIX (28/09) · PR A (#1890) tirou do anon as 4 funções que o AGENTE ATAK (Windows, Frioeste) chama com a
-- chave pública. Elas não estavam na lista de exceções porque não são chamadas por página, e sim pelo coletor
-- instalado no cliente (collectors/atak-agente/agent.js → rpc com PS_ANON_KEY). Efeito: desde ~09:30 o agente
-- não lê a configuração nem manda heartbeat → coleta parada.
-- As 4 exigem token do agente (atak_conexao_config.agente_token) antes de qualquer leitura/escrita — mesmo
-- critério das 22 exceções aprovadas (token no corpo). fn_atak_mapa_coletor (coletor antigo, recebe company_id
-- sem token) NÃO volta.
-- ci-allow-anon: agente ATAK instalado no cliente chama com a chave pública; as 4 exigem token do agente
GRANT EXECUTE ON FUNCTION public.fn_atak_agente_config(text) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_agente_heartbeat(text, text, text, timestamptz, text) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_atak_teste_responder(text, boolean, text) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_atak_heartbeat(text, text, text, text, text, integer, integer, text) TO anon;

DO $$
BEGIN
  IF NOT (has_function_privilege('anon', 'public.fn_atak_agente_config(text)', 'EXECUTE')
      AND has_function_privilege('anon', 'public.fn_agente_heartbeat(text,text,text,timestamptz,text)', 'EXECUTE')
      AND has_function_privilege('anon', 'public.fn_atak_teste_responder(text,boolean,text)', 'EXECUTE')
      AND has_function_privilege('anon', 'public.fn_atak_heartbeat(text,text,text,text,text,integer,integer,text)', 'EXECUTE')) THEN
    RAISE EXCEPTION 'hotfix agente: anon ainda sem EXECUTE nas funções do agente';
  END IF;
END $$;
