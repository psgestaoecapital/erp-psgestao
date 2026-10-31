-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas/rpcs_chamadas da tela
-- /dashboard/pm/pauta. Aditivo: só metadado em system_screens. Idempotente (filtrado pela rota).
-- Listas do grep .from()/.rpc() de src/app/dashboard/pm/pauta/page.tsx (+ libs pm/pauta, pm/cronometroGlobal).
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_aprovacoes','agency_campanhas','agency_clientes','agency_contratos','agency_grupos_clientes','agency_job_visto','agency_jobs','agency_pauta_preferencia','agency_servico','agency_timesheet','agency_visoes_pauta']::text[],
    rpcs_chamadas = ARRAY['fn_acessos_pode_gerir','fn_pauta_contadores','fn_pauta_desfazer','fn_pauta_listar','fn_pauta_opcoes','fn_usuarios_da_empresa']::text[]
WHERE rota = '/dashboard/pm/pauta';
