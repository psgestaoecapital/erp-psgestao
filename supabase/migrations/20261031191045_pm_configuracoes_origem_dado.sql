-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas/rpcs_chamadas da tela
-- /dashboard/pm/configuracoes. Aditivo: só metadado em system_screens. Idempotente (filtrado pela rota).
-- Listas do grep .from()/.rpc() de src/app/dashboard/pm/configuracoes/page.tsx.
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_comissao','agency_proposta_config','crm_alerta_config']::text[],
    rpcs_chamadas = ARRAY['fn_agency_config_excluir','fn_agency_config_listar','fn_agency_config_salvar','fn_funil_etapa_salvar','fn_funil_etapas_listar']::text[]
WHERE rota = '/dashboard/pm/configuracoes';
