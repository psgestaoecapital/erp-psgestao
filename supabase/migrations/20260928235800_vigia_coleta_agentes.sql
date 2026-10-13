-- CEO 28/09: vigia de coleta parada. A Frioeste ficou 4 horas sem coleta e só se soube porque alguém estava olhando.
-- Regra: QUALQUER agente (erp_agente_status) sem coleta há mais de 1 hora
--   (a) aparece no briefing (chave coleta_agentes + alertas_pendentes_para_ceo.coleta_parada) e
--   (b) abre UM chamado interno para a PS (empresa Ps Gestao LTDA — o cliente não vê), um por parada.
-- Quando a coleta volta, o alerta fecha e o chamado recebe a mensagem "coleta voltou" (fica para a PS encerrar).
-- Conexão desligada de propósito (atak_conexao_config.ativo = false) não alerta.
-- Histórico (7 dias até 28/09): o maior intervalo entre coletas fora das paradas foi de minutos — 1 hora não gera
-- alarme falso; as duas paradas de 28/09 (09:29→10:44 e 13:21→) teriam aberto chamado.

CREATE TABLE IF NOT EXISTS public.erp_agente_alerta_coleta (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id),
  aberto_em      timestamptz NOT NULL DEFAULT now(),
  ultima_coleta  timestamptz,
  sugestao_id    uuid REFERENCES public.sugestoes(id),
  fechado_em     timestamptz,
  coleta_voltou_em timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS erp_agente_alerta_coleta_um_aberto
  ON public.erp_agente_alerta_coleta (company_id) WHERE fechado_em IS NULL;
ALTER TABLE public.erp_agente_alerta_coleta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_agente_alerta_coleta FROM PUBLIC, anon, authenticated;

-- Leitura (sem efeito colateral): usada pelo briefing e pelo vigia.
CREATE OR REPLACE FUNCTION public.fn_agente_coleta_status(p_limite interval DEFAULT interval '1 hour')
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH ag AS (
    SELECT a.company_id, coalesce(c.nome_fantasia, c.razao_social) AS empresa, a.hostname, a.versao_agente,
           a.ultima_carga, a.ultimo_heartbeat,
           floor(extract(epoch FROM (now() - coalesce(a.ultima_carga, a.ultimo_heartbeat))) / 60)::int AS minutos_sem_coleta,
           coalesce(a.ultima_carga, a.ultimo_heartbeat) < now() - p_limite AS parado
    FROM erp_agente_status a
    JOIN companies c ON c.id = a.company_id
    WHERE NOT EXISTS (SELECT 1 FROM atak_conexao_config k WHERE k.company_id = a.company_id AND k.ativo IS FALSE)
  )
  SELECT jsonb_build_object(
    'ok', NOT EXISTS (SELECT 1 FROM ag WHERE parado),
    'limite_minutos', (extract(epoch FROM p_limite) / 60)::int,
    'total_agentes', (SELECT count(*) FROM ag),
    'parados', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'company_id', ag.company_id, 'empresa', ag.empresa, 'hostname', ag.hostname, 'versao', ag.versao_agente,
        'ultima_coleta', ag.ultima_carga, 'ultimo_heartbeat', ag.ultimo_heartbeat,
        'minutos_sem_coleta', ag.minutos_sem_coleta,
        'chamado_numero', (SELECT s.numero FROM erp_agente_alerta_coleta al JOIN sugestoes s ON s.id = al.sugestao_id
                            WHERE al.company_id = ag.company_id AND al.fechado_em IS NULL)
      ) ORDER BY ag.minutos_sem_coleta DESC), '[]'::jsonb) FROM ag WHERE ag.parado),
    'regra', 'Agente sem coleta há mais de 1 hora abre chamado interno para a PS (um por parada) e aparece aqui. Contato com o cliente passa pelo CEO.')
$$;
REVOKE ALL ON FUNCTION public.fn_agente_coleta_status(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agente_coleta_status(interval) TO service_role;

-- Vigia (cron a cada 10 min): abre o alerta + chamado interno na parada; fecha quando a coleta volta.
CREATE OR REPLACE FUNCTION public.fn_agente_coleta_vigiar()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  c_ps constant uuid := 'b26c19c0-bf6d-495b-b8d1-9fa8d6896725';  -- Ps Gestao LTDA (fila interna; o cliente não vê)
  c_robo constant uuid := '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa'; -- usuário de sistema (is_robo) assina a mensagem "coleta voltou"
  v_status jsonb := public.fn_agente_coleta_status();
  p jsonb; al record; v_sug uuid; v_num int; v_abertos int := 0; v_fechados int := 0;
  v_ultima timestamptz;
BEGIN
  -- (1) paradas novas → alerta + chamado interno
  FOR p IN SELECT * FROM jsonb_array_elements(v_status->'parados') LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM erp_agente_alerta_coleta
                          WHERE company_id = (p->>'company_id')::uuid AND fechado_em IS NULL);
    INSERT INTO sugestoes (user_id, user_email, user_name, tipo, titulo, descricao, prioridade, status, company_id, rota, area, categoria)
    VALUES (NULL, NULL, 'Vigia automático (coleta de agentes)', 'bug',
      'Coleta parada: ' || (p->>'empresa') || ' sem coleta há mais de 1 hora',
      'Chamado interno aberto pelo vigia automático — o cliente não vê este chamado.' || E'\n\n'
      || 'Empresa: ' || (p->>'empresa') || E'\n'
      || 'Agente: ' || coalesce(p->>'hostname', '?') || ' · versão ' || coalesce(p->>'versao', '?') || E'\n'
      || 'Última coleta: ' || coalesce(to_char((p->>'ultima_coleta')::timestamptz AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'), 'nunca') || ' (Brasília)' || E'\n'
      || 'Último sinal de vida: ' || coalesce(to_char((p->>'ultimo_heartbeat')::timestamptz AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'), 'nunca') || ' (Brasília)' || E'\n\n'
      || 'O que fazer: conferir o agente na tela Conectores. Se o sinal de vida também parou, o serviço caiu no computador do cliente. '
      || 'Contato com o cliente passa pelo CEO. Quando a coleta voltar, este chamado recebe o aviso automaticamente.',
      'alta', 'nova', c_ps, '/dashboard/industrial/conectores', 'industrial', 'bug')
    RETURNING id, numero INTO v_sug, v_num;
    INSERT INTO erp_agente_alerta_coleta (company_id, ultima_coleta, sugestao_id)
    VALUES ((p->>'company_id')::uuid, (p->>'ultima_coleta')::timestamptz, v_sug);
    v_abertos := v_abertos + 1;
  END LOOP;

  -- (2) coleta voltou → fecha o alerta e avisa no chamado
  FOR al IN SELECT * FROM erp_agente_alerta_coleta a WHERE a.fechado_em IS NULL
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_status->'parados') x WHERE (x->>'company_id')::uuid = a.company_id) LOOP
    SELECT coalesce(ultima_carga, ultimo_heartbeat) INTO v_ultima FROM erp_agente_status WHERE company_id = al.company_id;
    UPDATE erp_agente_alerta_coleta SET fechado_em = now(), coleta_voltou_em = v_ultima WHERE id = al.id;
    IF al.sugestao_id IS NOT NULL THEN
      INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto)
      VALUES (al.sugestao_id, c_robo, NULL, 'ps',
        'Vigia automático: a coleta voltou em '
        || coalesce(to_char(v_ultima AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'), '?') || ' (Brasília). '
        || 'Parada de ' || coalesce(to_char(al.ultima_coleta AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'), '?')
        || ' até a volta. Encerre o chamado depois de conferir a causa.');
    END IF;
    v_fechados := v_fechados + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'alertas_abertos', v_abertos, 'alertas_fechados', v_fechados, 'status', v_status);
END $$;
REVOKE ALL ON FUNCTION public.fn_agente_coleta_vigiar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agente_coleta_vigiar() TO service_role;

-- Cron: a cada 10 minutos
DO $do$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'vigia-coleta-agentes';
  PERFORM cron.schedule('vigia-coleta-agentes', '*/10 * * * *', 'SELECT public.fn_agente_coleta_vigiar()');
END $do$;

-- Briefing: chave coleta_agentes + alerta ao CEO quando houver agente parado
DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc WHERE proname = 'fn_briefing_sessao';
  IF v_def !~ 'fn_agente_coleta_status' THEN
    v_new := replace(v_def, E'  RETURN v_result;\nEND;',
      E'  -- 28/09: vigia de coleta — agente sem coleta há mais de 1 hora (abre chamado interno pelo cron vigia-coleta-agentes)\n'
      || E'  v_result := v_result || jsonb_build_object(''coleta_agentes'', public.fn_agente_coleta_status());\n'
      || E'  IF NOT coalesce((v_result->''coleta_agentes''->>''ok'')::boolean, true) THEN\n'
      || E'    v_result := jsonb_set(v_result, ''{alertas_pendentes_para_ceo,coleta_parada}'', jsonb_build_object(\n'
      || E'      ''parados'', v_result->''coleta_agentes''->''parados'',\n'
      || E'      ''acao'', ''Agente sem coleta há mais de 1 hora: ver o chamado interno aberto pelo vigia; contato com o cliente passa pelo CEO''), true);\n'
      || E'  END IF;\n'
      || E'  RETURN v_result;\nEND;');
    IF v_new = v_def THEN RAISE EXCEPTION 'fn_briefing_sessao: ancora RETURN v_result nao encontrada'; END IF;
    EXECUTE v_new;
  END IF;
END $do$;

REVOKE ALL ON FUNCTION public.fn_briefing_sessao() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_briefing_sessao() TO service_role;

-- Guarda: o briefing tem a chave e o vigia está agendado
DO $do$
BEGIN
  IF (SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'fn_briefing_sessao') !~ 'fn_agente_coleta_status' THEN
    RAISE EXCEPTION 'briefing sem coleta_agentes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vigia-coleta-agentes' AND active) THEN RAISE EXCEPTION 'cron vigia-coleta-agentes ausente'; END IF;
END $do$;
