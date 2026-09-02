-- Central de Melhorias · Fase 1 · registro no menu.
-- (a) Módulo do USUÁRIO: universal — is_shared + surface em gestao_empresarial (área base_universal
--     que TODA empresa enxerga), ramo compartilhado do sidebar (não é gated por plano). Assim
--     qualquer usuário de qualquer empresa alcança /dashboard/melhorias.
-- (b) Fila de ATENDIMENTO: ferramenta de suporte (PS_ADMIN/PS_SUPPORT). grupo=admin; a página
--     gateia por system_role e a RLS protege o dado. Atendente também chega por link condicional
--     na tela de melhorias.

INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, is_shared, surface_in_groups)
VALUES
  ('melhorias_central', 'Central de Melhorias', 'erp_core', 'inicio', 'Lightbulb',
   '/dashboard/melhorias', 5, true, true, ARRAY['gestao_empresarial']::text[]),
  ('atendimento_fila', 'Atendimento · Fila de Melhorias', 'admin', 'administracao', 'Inbox',
   '/dashboard/atendimento', 90, true, false, ARRAY[]::text[])
ON CONFLICT (id) DO NOTHING;
