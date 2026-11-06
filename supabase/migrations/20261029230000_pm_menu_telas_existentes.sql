-- P&M: coloca no menu lateral as 9 telas que já existem no código e estavam fora do menu (CEO 28/10/2026, 13:18).
-- Aditiva: só INSERT em module_catalog e plan_modules, idempotente (pode rodar de novo sem duplicar).
-- Os novos módulos entram nos mesmos planos que já têm a P&M (os planos que contêm pm_jobs),
-- com o mesmo is_default_active / minimum_sla do pm_jobs — sem isso o item não aparece para a empresa.
-- Não altera nem apaga nenhum módulo existente.

INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, rota, ordem, ativo, icone, layer, vertical_specific, legacy, rbac_isento, so_ps)
VALUES
  ('pm_painel_agencia',       'Painel da agência',       'pm', 'pm_comercial',    '/dashboard/pm',                      1,   true, 'LayoutDashboard', '3_specific', ARRAY['pm'], false, false, false),
  ('pm_comercial_visao',      'Comercial',               'pm', 'pm_comercial',    '/dashboard/pm/comercial',            12,  true, 'TrendingUp',      '3_specific', ARRAY['pm'], false, false, false),
  ('pm_contratos',            'Contratos',               'pm', 'pm_comercial',    '/dashboard/pm/contratos',            28,  true, 'Receipt',         '3_specific', ARRAY['pm'], false, false, false),
  ('pm_meus_trabalhos',       'Meus trabalhos',          'pm', 'pm_producao',     '/dashboard/pm/meus-trabalhos',       52,  true, 'ListChecks',      '3_specific', ARRAY['pm'], false, false, false),
  ('pm_painel_gestor',        'Painel do gestor',        'pm', 'pm_producao',     '/dashboard/pm/painel-gestor',        57,  true, 'BarChart3',       '3_specific', ARRAY['pm'], false, false, false),
  ('pm_comissao',             'Comissão',                'pm', 'pm_financeiro',   '/dashboard/pm/comissao',             105, true, 'Receipt',         '3_specific', ARRAY['pm'], false, false, false),
  ('pm_relatorio_documentos', 'Relatório de documentos', 'pm', 'pm_inteligencia', '/dashboard/pm/relatorio-documentos', 125, true, 'BarChart3',       '3_specific', ARRAY['pm'], false, false, false),
  ('pm_equipe',               'Equipe',                  'pm', 'pm_configuracao', '/dashboard/pm/equipe',               190, true, 'Users',           '3_specific', ARRAY['pm'], false, false, false),
  ('pm_importar_siga',        'Importar do SIGA',        'pm', 'pm_configuracao', '/dashboard/pm/importar-siga',        210, true, 'Plug',            '3_specific', ARRAY['pm'], false, false, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plan_modules (plan_id, module_id, is_default_active, minimum_sla, legacy)
SELECT base.plan_id, novo.id, base.is_default_active, base.minimum_sla, false
FROM public.plan_modules base
CROSS JOIN (VALUES ('pm_painel_agencia'), ('pm_comercial_visao'), ('pm_contratos'), ('pm_meus_trabalhos'),
                   ('pm_painel_gestor'), ('pm_comissao'), ('pm_relatorio_documentos'), ('pm_equipe'),
                   ('pm_importar_siga')) AS novo(id)
WHERE base.module_id = 'pm_jobs'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = base.plan_id AND x.module_id = novo.id);
