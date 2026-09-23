-- Relatório Plano Gerencial × Contábil · registro RD-35 (tela + menu + feature).
-- Vai junto com a página /dashboard/cadastros/plano-contas/relatorio (check_menu vê page + rota juntas).
-- Expande F.cadastros.plano_contas_v2 (feature já existente) — não cria feature nova.

-- 1) system_screens (auditável pelo robô)
INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, modulo, estado_real, prioridade_monitoramento, rpcs_chamadas, auditavel_robo)
VALUES
  ('dashboard.cadastros.plano_contas_relatorio', '/dashboard/cadastros/plano-contas/relatorio',
   'gestao_empresarial', 'Plano de Contas · Gerencial × Contábil',
   'Relatório que conecta o plano gerencial ao contábil (via erp_conta_contabil_vinculo), lista as contas contábeis analíticas sem vínculo e exporta Excel (2 abas) e PDF. Respeita a isolação plano_contas_proprio (#1715).',
   'cadastros', 'pronto', 'media', ARRAY['fn_plano_contas_relatorio']::text[], true)
ON CONFLICT (id) DO UPDATE SET
  rota=EXCLUDED.rota, area=EXCLUDED.area, titulo=EXCLUDED.titulo,
  descricao_funcional=EXCLUDED.descricao_funcional, modulo=EXCLUDED.modulo, estado_real=EXCLUDED.estado_real,
  prioridade_monitoramento=EXCLUDED.prioridade_monitoramento, rpcs_chamadas=EXCLUDED.rpcs_chamadas,
  auditavel_robo=EXCLUDED.auditavel_robo, atualizado_em=now();

-- 2) module_catalog (ao lado de ge_cadastros_plano_contas, ordem 40 → este 41)
INSERT INTO public.module_catalog
  (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, descricao, layer, is_shared, surface_in_groups)
VALUES
  ('ge_cadastros_plano_contas_relatorio', 'Plano × Contábil', 'gestao_empresarial', 'cadastros',
   'FileBarChart2', '/dashboard/cadastros/plano-contas/relatorio', 41, true,
   'Relatório gerencial × contábil do plano de contas (Excel/PDF).', 'shared', true,
   ARRAY['gestao_empresarial']::text[])
ON CONFLICT (id) DO NOTHING;

-- 3) screen_route_features (expansão da feature existente)
INSERT INTO public.screen_route_features (screen_id, feature_id, peso, visibilidade)
VALUES ('dashboard.cadastros.plano_contas_relatorio', 'F.cadastros.plano_contas_v2', 1, 'primary')
ON CONFLICT DO NOTHING;
