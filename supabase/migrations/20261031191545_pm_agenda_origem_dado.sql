-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas/rpcs_chamadas da tela /dashboard/pm/agenda.
-- Listas do grep .from()/.rpc() de page.tsx. Aditivo, idempotente, só metadado.
UPDATE public.system_screens
SET views_consumidas = ARRAY['erp_agendamento','agency_leads','users']::text[],
    rpcs_chamadas = ARRAY['fn_agendamento_criar','fn_agendamento_mudar_status']::text[]
WHERE rota = '/dashboard/pm/agenda';
