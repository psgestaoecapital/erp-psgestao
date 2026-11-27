-- EHS · PDCA · /dashboard/ehs/calendario · RD-98 pilar 1 (sem tela morta)
-- Code: desenvolvedor_5_g
--
-- Problema (auditor_pdca_1, provado no dado — RD-38):
--   A DEMO "EHS Modelo - DEMO" (b0700000-0000-4000-a000-00000000000b) tem 67 documentos de
--   compliance (55 COM data_validade), mas 0 tarefas em compliance_calendar_tarefas. A geração
--   (fn_compliance_calendar_gerar_de_documentos / _gerar_recorrentes_mensais) nunca rodou na DEMO,
--   então v_compliance_calendar_dashboard retorna 0 linhas e /dashboard/ehs/calendario abre vazio
--   ("Tudo em dia!"), escondendo 15 vencimentos reais (8 já vencidos + 7 vencendo em ≤90 dias).
--
-- Correção: semear o calendário da DEMO a partir dos documentos. Prova (BEGIN/ROLLBACK):
--   fn_compliance_calendar_gerar_de_documentos(..,365) -> 55 tarefas; _gerar_recorrentes_mensais -> 5.
--
-- Segurança / disciplina:
--   • SÓ na DEMO (guard companies.is_demo = true); nunca toca dado de cliente.
--   • Aditivo (apenas INSERT via função SECURITY DEFINER existente; nenhum DROP/DELETE/UPDATE em massa).
--   • Idempotente: só gera quando o calendário da DEMO está vazio — as funções NÃO são idempotentes
--     (compliance_calendar_tarefas só tem PK em id; o ON CONFLICT DO NOTHING delas nunca dispara),
--     então re-rodar sem este guard duplicaria as tarefas.

DO $$
DECLARE
  v_company    uuid := 'b0700000-0000-4000-a000-00000000000b';
  v_is_demo    boolean;
  v_existentes integer;
  v_geradas    integer;
BEGIN
  SELECT is_demo INTO v_is_demo FROM public.companies WHERE id = v_company;
  IF v_is_demo IS NOT TRUE THEN
    RAISE NOTICE 'EHS seed calendário: empresa % não é DEMO (is_demo=%); ignorado.', v_company, v_is_demo;
    RETURN;
  END IF;

  SELECT count(*) INTO v_existentes
    FROM public.compliance_calendar_tarefas
   WHERE company_id = v_company;
  IF v_existentes > 0 THEN
    RAISE NOTICE 'EHS seed calendário: DEMO já tem % tarefa(s); ignorado (idempotente).', v_existentes;
    RETURN;
  END IF;

  PERFORM public.fn_compliance_calendar_gerar_de_documentos(v_company, 365);
  PERFORM public.fn_compliance_calendar_gerar_recorrentes_mensais(v_company, NULL);

  SELECT count(*) INTO v_geradas
    FROM public.compliance_calendar_tarefas
   WHERE company_id = v_company;
  RAISE NOTICE 'EHS seed calendário DEMO: % tarefa(s) geradas a partir dos documentos.', v_geradas;
END $$;
