-- #774 · Rótulo do menu "Certificado Digital A1" → "Configuração Fiscal".
-- O rótulo da sidebar vem do banco: module_catalog.nome, servido pela RPC fn_modulos_sidebar_por_area.
-- Os arquivos .ts (sidebar-config / dashboard-menu-config) são só fallback de rpc-error.
-- A correção já foi aplicada em produção via UPDATE manual (CEO); esta migration VERSIONA a mudança
-- para que qualquer outro ambiente (ou um banco recriado) nasça com o rótulo correto. Idempotente.
UPDATE public.module_catalog SET nome = 'Configuração Fiscal' WHERE id = 'admin_certificado_a1';
