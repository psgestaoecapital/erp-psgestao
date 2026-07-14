-- RD-49 · registro da tela no menu/monitoramento (colunas reais · RD-44).
-- module_catalog: grupo/is_shared/surface_in_groups (NÃO 'area'). system_screens: titulo/area/estado_real (NÃO 'nome').
-- O menu VISÍVEL já é ligado no sidebar-config.ts (grupo Inteligência); isto evita o "tela órfã" no drift.

INSERT INTO module_catalog (id, nome, rota, grupo, icone, ativo, is_shared, surface_in_groups)
SELECT gen_random_uuid(), 'Divergências', '/dashboard/_compartilhado/divergencias', 'erp_core', 'alert-triangle', true, true, ARRAY['INTELIGENCIA E PROTECAO']
WHERE NOT EXISTS (SELECT 1 FROM module_catalog WHERE rota='/dashboard/_compartilhado/divergencias');

INSERT INTO system_screens (id, rota, area, titulo, estado_real)
SELECT gen_random_uuid(), '/dashboard/_compartilhado/divergencias', 'inteligencia', 'Fila de Divergências', 'pronto'
WHERE NOT EXISTS (SELECT 1 FROM system_screens WHERE rota='/dashboard/_compartilhado/divergencias');
