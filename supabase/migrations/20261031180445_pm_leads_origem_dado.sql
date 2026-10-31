-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas/rpcs_chamadas da tela /dashboard/pm/leads.
-- Listas do grep .from()/.rpc() de page.tsx. Aditivo, idempotente, só metadado.
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_leads','agency_propostas','erp_contratos','erp_agendamento','agency_lead_tarefa','erp_clientes','agency_lead_origem']::text[],
    rpcs_chamadas = ARRAY['fn_funil_etapas_listar','fn_agency_origens_listar','fn_crm_leads_tempo','fn_usuarios_da_empresa','fn_cliente_buscar','fn_cliente_criar_inline','fn_agency_lead_criar','fn_agency_lead_ganhar','fn_agency_lead_proposta_criar','fn_pm_proposta_do_lead','fn_crm_lead_excluir','fn_funil_etapa_salvar','fn_funil_etapa_excluir','fn_agency_origem_salvar','fn_agency_origem_excluir','fn_agendamento_criar']::text[]
WHERE rota = '/dashboard/pm/leads';
