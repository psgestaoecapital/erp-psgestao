-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas/rpcs_chamadas da tela
-- /dashboard/pm/meu-dia. Aditivo: só metadado em system_screens. Idempotente (filtrado pela rota).
-- Listas do grep .from()/.rpc() de src/app/dashboard/pm/meu-dia/page.tsx (+ libs pm/meuDia, pm/pauta).
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_anotacoes','agency_aprovacoes','agency_job_comentarios','agency_pauta_lote','agency_timesheet']::text[],
    rpcs_chamadas = ARRAY['fn_pauta_listar','fn_usuarios_da_empresa']::text[]
WHERE rota = '/dashboard/pm/meu-dia';
