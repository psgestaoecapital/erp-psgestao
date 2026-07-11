-- ============================================================
-- Item de menu "Pedidos" (/dashboard/pedidos) — espelha o "Orçamento".
-- A tela existia sem entrada no menu; a Jordana não achava o caminho pro
-- pedido. module_catalog + plan_modules por migração versionada (não drift);
-- NUNCA hardcode em sidebar-config.ts. Menu popula via fn_modulos_sidebar_por_area.
-- ============================================================

INSERT INTO module_catalog
  (id, nome, grupo, icone, rota, ordem, ativo, layer, vertical_specific,
   is_shared, dependencies, legacy, subgrupo, surface_in_groups, diferencial)
VALUES
  ('pedidos','Pedidos','erp_ext','📦','/dashboard/pedidos',31,true,'2_svc',
   ARRAY['hub','medica','odonto','oficina','pm','services'],
   true, ARRAY[]::text[], false, 'contratos_vendas',
   ARRAY['services','pm'], false)
ON CONFLICT (id) DO UPDATE SET
  nome=EXCLUDED.nome, grupo=EXCLUDED.grupo, icone=EXCLUDED.icone, rota=EXCLUDED.rota,
  subgrupo=EXCLUDED.subgrupo, surface_in_groups=EXCLUDED.surface_in_groups,
  vertical_specific=EXCLUDED.vertical_specific, is_shared=EXCLUDED.is_shared, ativo=true;

-- Disponibiliza "Pedidos" em TODO plano que já tem "Orçamento" (mesma cobertura,
-- inclui os planos ativos da KGF: v15_oficina_grande, v15_gestao_empresarial_pro).
INSERT INTO plan_modules (plan_id, module_id, is_default_active, legacy)
SELECT plan_id, 'pedidos', is_default_active, false
FROM plan_modules WHERE module_id='orcamento'
ON CONFLICT DO NOTHING;
