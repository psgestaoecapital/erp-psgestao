-- RD-98 p3 (ORIGEM DO DADO): /dashboard/pm/portfolio. Grep .from() de page.tsx (só leitura de tabelas). Aditivo, idempotente.
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_jobs','agency_clientes']::text[]
WHERE rota = '/dashboard/pm/portfolio';
