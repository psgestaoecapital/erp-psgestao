-- Menu lateral: repontar o item "Admin" (module_catalog.admin_painel — dirige o menu REAL via
-- fn_modulos_sidebar_por_area) da v9.1 (/dashboard/admin) para a nova cascata Fase 1 (/dashboard/admin/acessos).
-- A v9.1 segue acessível por URL direta (a rota /dashboard/admin continua existindo) até ser aposentada.
-- Aditivo, reversível. Provado: fn_modulos_sidebar_por_area('industrial',Frioeste,NULL) emite admin_painel
-- com rota '/dashboard/admin/acessos?area=industrial'. (sidebar-config.ts, o fallback, foi alinhado no mesmo PR.)
UPDATE public.module_catalog SET rota = '/dashboard/admin/acessos' WHERE id = 'admin_painel';
