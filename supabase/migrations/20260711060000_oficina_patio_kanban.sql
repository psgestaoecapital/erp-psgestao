-- ============================================================
-- PR 2 — Pátio Kanban (tela principal da oficina) + higiene dos placeholders.
-- (a) legacy=true nos 8 módulos "oficina" que eram placeholders SEM tela
--     (RD-30: não deleta — só tira do menu; ids preservados p/ histórico).
--     NÃO mexe em oficina_os (a OS real) nem oficina_whatsapp_ia (acopla GE).
-- (b) registra o módulo oficina_patio (/dashboard/oficina/patio) + plan_modules
--     nos mesmos planos que já têm oficina_os (aparece p/ quem tem a OS).
-- ============================================================

-- (a) placeholders mortos → legacy (somem do menu, RD-30)
UPDATE module_catalog SET legacy = true, ativo = false
WHERE id IN (
  'oficina_apontamento_mecanico',
  'oficina_aprovacao_cliente',
  'oficina_diagnostico',
  'oficina_recepcao',
  'oficina_upsell_ia',
  'oficina_comissao',
  'oficina_estoque_pecas',
  'oficina_veiculos_fipe'
);

-- (b) módulo do Pátio Kanban (nativo da oficina; surfa via BRANCH 1 grupo=oficina)
INSERT INTO module_catalog
  (id, nome, grupo, icone, rota, ordem, ativo, layer, vertical_specific,
   is_shared, dependencies, legacy, subgrupo, surface_in_groups, diferencial)
VALUES
  ('oficina_patio', 'Pátio', 'oficina', '🚗', '/dashboard/oficina/patio', 1, true, '2_svc',
   ARRAY['oficina']::text[], false, ARRAY[]::text[], false, 'patio', ARRAY[]::text[], true)
ON CONFLICT (id) DO UPDATE SET
  nome=EXCLUDED.nome, grupo=EXCLUDED.grupo, icone=EXCLUDED.icone, rota=EXCLUDED.rota,
  subgrupo=EXCLUDED.subgrupo, ativo=true, legacy=false;

-- disponibiliza o Pátio em todo plano que já tem a OS da oficina
INSERT INTO plan_modules (plan_id, module_id, is_default_active, legacy)
SELECT plan_id, 'oficina_patio', is_default_active, false
FROM plan_modules WHERE module_id='oficina_os'
ON CONFLICT DO NOTHING;
