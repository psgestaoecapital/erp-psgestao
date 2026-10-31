-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas da tela /dashboard/projetos/takeoff/acervo.
-- A tela lista as plantas analisadas a partir de erp_obra_planta (grep .from() de page.tsx); sem RPC. Aditivo, idempotente.
UPDATE public.system_screens
SET views_consumidas = ARRAY['erp_obra_planta']::text[]
WHERE rota = '/dashboard/projetos/takeoff/acervo';
