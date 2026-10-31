-- RD-98 p3 (ORIGEM DO DADO): /dashboard/pm/comercial. Grep .from()/.rpc() de page.tsx. Aditivo, idempotente.
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_leads','agency_propostas','erp_contratos','agency_comissao']::text[],
    rpcs_chamadas = ARRAY['fn_funil_etapas_listar']::text[]
WHERE rota = '/dashboard/pm/comercial';
