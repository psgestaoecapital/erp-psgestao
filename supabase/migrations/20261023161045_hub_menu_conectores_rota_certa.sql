-- HB0 item 2 (Hub): "Conectores (ERPs)" no menu do Hub levava a /dashboard/industrial/conectores (tela do ATAK,
-- da vertical industrial), que devolve o usuário do Hub para a home da GE. O Hub passa a ter módulo PRÓPRIO,
-- apontando para a tela de conectores geral (/dashboard/conectores). ADITIVA para as demais verticais:
-- o módulo compartilhado admin_conectores_erp só perde a superfície 'hub'; nada é apagado.

INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, layer, icone, rota, ordem, ativo, is_shared, descricao, surface_in_groups)
VALUES ('hub_conectores_erp', 'Conectores (ERPs)', 'hub', 'administracao', NULL, NULL,
        '/dashboard/conectores', 60, true, false,
        'Liga o ERP do cliente (financeiro, industrial, agro, RH) ao PS para importar dados das obras.',
        ARRAY['hub']::text[])
ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, grupo = EXCLUDED.grupo, subgrupo = EXCLUDED.subgrupo,
  rota = EXCLUDED.rota, ordem = EXCLUDED.ordem, ativo = true, descricao = EXCLUDED.descricao,
  surface_in_groups = EXCLUDED.surface_in_groups;

-- Mesmos planos do módulo irmão do Hub.
INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, 'hub_conectores_erp' FROM public.plan_modules pm
WHERE pm.module_id = 'projetos_acompanhamento'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'hub_conectores_erp');

-- RBAC: administração — só administrador/sócio (mesma regra do admin_conectores_erp, 20260721020000).
WITH niv(nivel) AS (VALUES
 ('assessor_admin'),('assessor_usuario'),('cliente_bpo'),('cliente_wealth'),('comercial'),
 ('conselheiro'),('consultor'),('contador_admin'),('contador_viewer'),('coordenador'),
 ('diretor'),('financeiro'),('gerente'),('operacional'),('supervisor'),('visualizador'),
 ('diretor_area'),('gerente_planta'),('gerente_processo'),('supervisor_turno'),
 ('operador'),('rh_industrial'),('sst'))
INSERT INTO public.permissoes_nivel (modulo_id, nivel, pode_ver, pode_editar, pode_excluir, pode_exportar)
SELECT 'hub_conectores_erp', n.nivel, false, false, false, false FROM niv n
ON CONFLICT (modulo_id, nivel) DO UPDATE
  SET pode_ver = false, pode_editar = false, pode_excluir = false, pode_exportar = false;

-- Sai a entrada antiga do Hub (rota da vertical industrial).
UPDATE public.module_catalog
   SET surface_in_groups = array_remove(surface_in_groups, 'hub')
 WHERE id = 'admin_conectores_erp'
   AND 'hub' = ANY(surface_in_groups);
