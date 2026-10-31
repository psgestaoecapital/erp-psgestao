-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas/rpcs_chamadas da tela
-- /dashboard/pm/propostas. Aditivo: só metadado em system_screens. Idempotente (filtrado pela rota).
-- Listas do grep .from()/.rpc() de src/app/dashboard/pm/propostas/page.tsx.
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_clientes','agency_leads','agency_proposta_config','agency_proposta_itens','agency_propostas','erp_clientes','erp_contratos']::text[],
    rpcs_chamadas = ARRAY['fn_agency_proposta_aprovar','fn_agency_proposta_criar','fn_agency_proposta_editar','fn_agency_proposta_excluir','fn_agency_proposta_itens_sync','fn_agency_servico_listar_proposta','fn_cliente_buscar','fn_cliente_criar_inline']::text[]
WHERE rota = '/dashboard/pm/propostas';
