-- EHS · Calendário de Compliance · seed da empresa DEMO EHS (PDCA RD-98 p1 — SEM TELA MORTA)
--
-- Gap (auditor_pdca_1, provado no dado RD-38): a tela /dashboard/ehs/calendario lê
-- v_compliance_calendar_dashboard e, na DEMO "EHS Modelo - DEMO"
-- (b0700000-0000-4000-a000-00000000000b), ela retornava 0 LINHAS — calendário vazio —
-- apesar de a FONTE ter 67 documentos (55 COM data_validade, vários vencendo). As funções
-- de geração do calendário (fn_compliance_calendar_gerar_de_documentos /
-- fn_compliance_calendar_gerar_recorrentes_mensais) nunca haviam rodado nessa empresa, então
-- compliance_calendar_tarefas ficava com 0 linhas. Resultado: tela morta e o usuário não via
-- nenhum dos vencimentos reais já cadastrados.
--
-- Esta migration SEMEIA o calendário SOMENTE na DEMO EHS, rodando as funções de geração
-- (SECURITY DEFINER, idempotentes via ON CONFLICT DO NOTHING; sem auth.uid() = contexto de
-- serviço, passa a guarda de empresa). É ADITIVA: sem DDL, sem UPDATE/DELETE, sem tocar dado
-- de cliente. Reexecução não duplica (ON CONFLICT DO NOTHING). Guard duplo: companies.is_demo
-- = true E id = b0700000-0000-4000-a000-00000000000b.
--
-- Prova (ROLLBACK em produção, antes do merge): 0 -> 60 tarefas
-- (55 de documento + 5 recorrentes; 12 vencendo <=90d, 8 vencidas) e dashboard 0 -> 1 linha.

DO $$
DECLARE
  v_company uuid := 'b0700000-0000-4000-a000-00000000000b';
  v_antes   integer;
  v_depois  integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.companies WHERE id = v_company AND is_demo = true
  ) THEN
    RAISE NOTICE 'DEMO EHS % ausente ou nao-demo; seed do calendario ignorado.', v_company;
    RETURN;
  END IF;

  SELECT count(*) INTO v_antes
    FROM public.compliance_calendar_tarefas WHERE company_id = v_company;

  -- Gera tarefas a partir dos documentos com validade (horizonte amplo: 365d) e das
  -- obrigacoes recorrentes mensais. Idempotente.
  PERFORM public.fn_compliance_calendar_gerar_de_documentos(v_company, 365);
  PERFORM public.fn_compliance_calendar_gerar_recorrentes_mensais(v_company, NULL);

  SELECT count(*) INTO v_depois
    FROM public.compliance_calendar_tarefas WHERE company_id = v_company;

  RAISE NOTICE 'Calendario DEMO EHS: % -> % tarefas (seed PDCA RD-98 p1).', v_antes, v_depois;
END $$;
