-- RD-98 p3 (ORIGEM DO DADO): /dashboard/pm/servicos. Grep .from()/.rpc() de page.tsx. Aditivo, idempotente.
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_servico','agency_equipe','agency_config_opcao']::text[],
    rpcs_chamadas = ARRAY['fn_agency_config_listar','fn_agency_config_salvar','fn_agency_config_excluir']::text[]
WHERE rota = '/dashboard/pm/servicos';
