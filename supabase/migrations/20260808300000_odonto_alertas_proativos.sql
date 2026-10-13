-- SPEC IA-1.4 · Odonto — Alertas Pró-ativos (a IA avisa ANTES). RD-56/RD-41/RD-51/RD-26.
-- Núcleo RULE-BASED (custo ZERO, sempre roda). Reusa a infra que já existe: escreve em
-- erp_alerta_proativo, aparece no sininho (v_alertas_ativos) e no painel. A camada de IA (opcional,
-- togglável 'alertas_proativos') vive na rota /api/odonto/alertas e só prioriza/agrupa — nunca inventa.
-- Idempotente: regenera sem empilhar duplicado, resolve os que deixaram de valer, RESPEITA "Dispensar".

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) IMPL (sem guard de usuário) — usado pelo wrapper com guard E pelo cron (sem JWT).
--    Calcula as métricas DIRETO (não chama fn_odonto_clinica_contexto_ia, que tem guard de usuário).
CREATE OR REPLACE FUNCTION public._fn_odonto_alertas_gerar_impl(p_company_id uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tipos text[] := ARRAY['odonto_orcamento_sem_agendar','odonto_paciente_sumido','odonto_agenda_amanha_vazia','odonto_inadimplencia','odonto_plano_parado'];
  v_sem_agendar int; v_risco int; v_amanha int; v_parado int; v_ativos int; v_inad numeric;
BEGIN
  -- planos aprovados SEM próxima consulta agendada
  SELECT count(*) INTO v_sem_agendar FROM erp_odonto_plano_tratamento t
   WHERE t.company_id = p_company_id AND t.status = 'aprovado'
     AND NOT EXISTS (SELECT 1 FROM erp_odonto_agendamento a WHERE a.paciente_id = t.paciente_id AND a.data >= current_date AND a.status NOT IN ('cancelado','faltou'));

  -- pacientes em risco de evasão: ativos, plano não concluído, >60d sem consulta (ou nunca)
  SELECT count(*) INTO v_risco FROM (
    SELECT p.id FROM erp_odonto_paciente p
    LEFT JOIN erp_odonto_agendamento a ON a.paciente_id = p.id AND a.data <= current_date
    WHERE p.company_id = p_company_id AND p.ativo
      AND EXISTS (SELECT 1 FROM erp_odonto_plano_tratamento t WHERE t.paciente_id = p.id AND t.status IN ('aprovado','em_andamento','orcamento'))
    GROUP BY p.id HAVING max(a.data) IS NULL OR max(a.data) < current_date - 60) r;

  -- agenda de amanhã (ocupação real; sem meta inventada — RD-51)
  SELECT count(*) INTO v_amanha FROM erp_odonto_agendamento
   WHERE company_id = p_company_id AND data = current_date + 1 AND status NOT IN ('cancelado','faltou');
  SELECT count(*) FILTER (WHERE ativo) INTO v_ativos FROM erp_odonto_paciente WHERE company_id = p_company_id;

  -- inadimplência odonto (títulos vencidos do odonto)
  SELECT coalesce(sum(valor) FILTER (WHERE status IN ('aberto','vencido') AND data_vencimento < current_date), 0) INTO v_inad
   FROM erp_receber WHERE company_id = p_company_id AND (ref_externa_sistema = 'odonto_plano' OR categoria = 'Odontologia');

  -- planos parados: aprovado/andamento há >30d sem NENHUM item concluído
  SELECT count(*) INTO v_parado FROM erp_odonto_plano_tratamento t
   WHERE t.company_id = p_company_id AND t.status IN ('aprovado','em_andamento')
     AND coalesce(t.aprovado_em, t.created_at) < now() - interval '30 days'
     AND NOT EXISTS (SELECT 1 FROM erp_odonto_plano_item i WHERE i.plano_id = t.id AND i.concluido_em IS NOT NULL);

  -- limpa os que ESTE gerador administra e NÃO foram dispensados (mantém dispensado intocado)
  DELETE FROM erp_alerta_proativo WHERE company_id = p_company_id AND tipo = ANY(v_tipos) AND NOT dispensado;

  -- helper de insert (só insere se ninguém dispensou aquele tipo)
  IF v_sem_agendar > 0 AND NOT EXISTS (SELECT 1 FROM erp_alerta_proativo WHERE company_id = p_company_id AND tipo = 'odonto_orcamento_sem_agendar' AND dispensado) THEN
    INSERT INTO erp_alerta_proativo (company_id, tipo, severidade, titulo, mensagem, contexto, link_acao)
    VALUES (p_company_id, 'odonto_orcamento_sem_agendar', 'media', 'Orçamentos aprovados sem agendar',
      v_sem_agendar || ' plano(s) aprovado(s) sem próxima consulta agendada. Ligue para agendar antes que esfrie.',
      jsonb_build_object('qtd', v_sem_agendar), '/dashboard/odonto/pacientes');
  END IF;

  IF v_risco > 0 AND NOT EXISTS (SELECT 1 FROM erp_alerta_proativo WHERE company_id = p_company_id AND tipo = 'odonto_paciente_sumido' AND dispensado) THEN
    INSERT INTO erp_alerta_proativo (company_id, tipo, severidade, titulo, mensagem, contexto, link_acao)
    VALUES (p_company_id, 'odonto_paciente_sumido', CASE WHEN v_risco >= 5 THEN 'alta' ELSE 'media' END, 'Pacientes em risco de evasão',
      v_risco || ' paciente(s) com tratamento ativo e mais de 60 dias sem consulta. Vale uma campanha de reativação.',
      jsonb_build_object('qtd', v_risco), '/dashboard/odonto/pacientes');
  END IF;

  IF v_ativos > 0 AND v_amanha = 0 AND NOT EXISTS (SELECT 1 FROM erp_alerta_proativo WHERE company_id = p_company_id AND tipo = 'odonto_agenda_amanha_vazia' AND dispensado) THEN
    INSERT INTO erp_alerta_proativo (company_id, tipo, severidade, titulo, mensagem, contexto, link_acao)
    VALUES (p_company_id, 'odonto_agenda_amanha_vazia', 'baixa', 'Agenda de amanhã vazia',
      'Nenhum atendimento agendado para amanhã. Que tal encaixar retornos ou reativações?',
      jsonb_build_object('data', (current_date + 1)::text), '/dashboard/odonto/agenda');
  END IF;

  IF v_inad > 0 AND NOT EXISTS (SELECT 1 FROM erp_alerta_proativo WHERE company_id = p_company_id AND tipo = 'odonto_inadimplencia' AND dispensado) THEN
    INSERT INTO erp_alerta_proativo (company_id, tipo, severidade, titulo, mensagem, contexto, link_acao)
    VALUES (p_company_id, 'odonto_inadimplencia', 'alta', 'Inadimplência odontológica',
      'R$ ' || TO_CHAR(v_inad, 'FM999G999G999D00') || ' em títulos odontológicos vencidos. Acione a régua de cobrança.',
      jsonb_build_object('total', v_inad), '/dashboard/financeiro/inadimplentes');
  END IF;

  IF v_parado > 0 AND NOT EXISTS (SELECT 1 FROM erp_alerta_proativo WHERE company_id = p_company_id AND tipo = 'odonto_plano_parado' AND dispensado) THEN
    INSERT INTO erp_alerta_proativo (company_id, tipo, severidade, titulo, mensagem, contexto, link_acao)
    VALUES (p_company_id, 'odonto_plano_parado', 'media', 'Planos parados',
      v_parado || ' plano(s) aprovado(s) há mais de 30 dias sem nenhum procedimento concluído.',
      jsonb_build_object('qtd', v_parado), '/dashboard/odonto/tratamento');
  END IF;

  RETURN (SELECT count(*)::int FROM erp_alerta_proativo WHERE company_id = p_company_id AND tipo = ANY(v_tipos) AND NOT resolvido AND NOT dispensado);
END $$;
REVOKE ALL ON FUNCTION public._fn_odonto_alertas_gerar_impl(uuid) FROM anon, authenticated;

-- 2) Wrapper público (com guard de empresa) — on-demand pelo painel/botão "Atualizar alertas"
CREATE OR REPLACE FUNCTION public.fn_odonto_alertas_gerar(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  v_n := _fn_odonto_alertas_gerar_impl(p_company_id);
  RETURN jsonb_build_object('ok', true, 'ativos', v_n);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_alertas_gerar(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_alertas_gerar(uuid) TO authenticated;

-- 3) Cron (sem JWT): roda pra toda clínica com pacientes cadastrados
CREATE OR REPLACE FUNCTION public.fn_odonto_alertas_gerar_todas()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_c uuid; v_n int := 0;
BEGIN
  FOR v_c IN SELECT DISTINCT company_id FROM erp_odonto_paciente LOOP
    PERFORM _fn_odonto_alertas_gerar_impl(v_c); v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'empresas', v_n);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_alertas_gerar_todas() FROM anon, authenticated;

-- 4) Ação do alerta (resolver/dispensar) — guard pela empresa DONA do alerta. RLS do painel é SELECT;
--    a mutação passa por aqui (SECURITY DEFINER). Reusa as colunas resolvido/dispensado que já existem.
CREATE OR REPLACE FUNCTION public.fn_alerta_acao(p_alerta_id uuid, p_acao text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM erp_alerta_proativo WHERE id = p_alerta_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'alerta não encontrado'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF p_acao = 'resolver' THEN
    UPDATE erp_alerta_proativo SET resolvido = true, resolvido_em = now() WHERE id = p_alerta_id;
  ELSIF p_acao = 'dispensar' THEN
    UPDATE erp_alerta_proativo SET dispensado = true WHERE id = p_alerta_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'erro', 'ação inválida'); END IF;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.fn_alerta_acao(uuid,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_alerta_acao(uuid,text) TO authenticated;

-- 5) Cron diário (madrugada). CEO autorizou. Idempotente: unschedule antes (evita duplicar no re-run).
DO $$
BEGIN
  PERFORM cron.unschedule('odonto-alertas-diario') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'odonto-alertas-diario');
  PERFORM cron.schedule('odonto-alertas-diario', '0 5 * * *', 'SELECT public.fn_odonto_alertas_gerar_todas();');
END $$;
