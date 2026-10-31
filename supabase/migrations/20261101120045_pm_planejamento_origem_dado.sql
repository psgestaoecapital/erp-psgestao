-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas/rpcs_chamadas da tela
-- /dashboard/pm/planejamento. Aditivo: só metadado em system_screens. Idempotente (filtrado pela rota).
-- Listas do grep .from()/.rpc() de src/app/dashboard/pm/planejamento/page.tsx (+ lib pm/social).
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_jobs','agency_planejamentos','agency_posts','agency_servico','erp_clientes']::text[],
    rpcs_chamadas = ARRAY['fn_agency_config_listar','fn_usuarios_da_empresa']::text[]
WHERE rota = '/dashboard/pm/planejamento';
