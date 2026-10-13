-- MENU INDUSTRIAL (SPEC CEO) — só reorganização de menu (module_catalog/feature_catalog), reversível.
-- ANTES (registro RD-55):
--  · badges: industrial_ponto_eletronico / abastecimento_dados / industrial_folha_pagamento = SEM feature_catalog (=previsto).
--  · rótulos: abastecimento_dados='Abastecimento de Dados' · industrial_folha_pagamento='Folha de Pagamento'.
--  · intrusos: 12 módulos shared com 'industrial' em surface_in_groups (financeiro/fin_recorrente/contratos/crm).
-- Reverter: remover as 3 linhas de feature_catalog / renomear de volta / array_append('industrial') nos 12.

-- 1 · BADGES → PRONTO (em uso real: ponto 71k marcações, abastecimento e folha em uso). RD-51: UI não mente.
INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto)
SELECT gen_random_uuid(), mc.id, 'industrial', mc.nome, coalesce(nullif(mc.descricao,''), mc.nome), 'pronto', 100
FROM public.module_catalog mc
WHERE mc.id IN ('industrial_ponto_eletronico','abastecimento_dados','industrial_folha_pagamento')
  AND NOT EXISTS (SELECT 1 FROM public.feature_catalog fc WHERE fc.module_id = mc.id);
UPDATE public.feature_catalog SET status='pronto', percentual_pronto=100, atualizado_em=now()
  WHERE module_id IN ('industrial_ponto_eletronico','abastecimento_dados','industrial_folha_pagamento');

-- 2 · RÓTULOS curtos (não truncam no menu)
UPDATE public.module_catalog SET nome='Abastecimento' WHERE id='abastecimento_dados';
UPDATE public.module_catalog SET nome='Folha'         WHERE id='industrial_folha_pagamento';

-- 3 · REMOVER intrusos da área Industrial (Financeiro · Fin. Recorrente · Contratos & Vendas · CRM).
--     Só tira do menu INDUSTRIAL (continuam nas outras áreas). Quem precisar troca p/ Gestão Empresarial.
UPDATE public.module_catalog SET surface_in_groups = array_remove(surface_in_groups, 'industrial')
WHERE 'industrial' = ANY(surface_in_groups)
  AND id IN ('conciliacao_geral','previsao_caixa','services_cobranca_recorrente','services_nfse',
             'services_dashboard_saas','services_mensalidade_gestao','services_contratos_recorrentes',
             'services_onboarding_ia','services_portal_cliente','services_atendimento_chat',
             'services_cancelamento_workflow','services_pesquisa_nps');
