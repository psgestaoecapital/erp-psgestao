-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas da tela /dashboard/pm/relatorio-documentos.
-- A tela monta o relatório lendo tabelas direto (grep .from() de page.tsx); não chama RPC. Aditivo, idempotente.
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_propostas','agency_contratos','agency_clientes','agency_equipe']::text[]
WHERE rota = '/dashboard/pm/relatorio-documentos';
