-- PR-FIX-MENU-LATERAL-GE (CEO 26/05/2026)
-- Aplicado via MCP apply_migration · rastreio histórico.
--
-- BUG: 6 telas criadas no batch PR #162-#167 estavam órfãs no menu lateral GE.
-- Usuário precisava digitar URL manualmente · Pilar 3 (Facilidade) violado.
--
-- Sidebar do dashboard é dinâmica · gerada por fn_modulos_sidebar_por_area
-- a partir de module_catalog (subgrupo · grupo · rota · ordem · ativo).
--
-- Resultado pós-migration (fn_modulos_sidebar_por_area('gestao_empresarial')):
--   FINANCEIRO UNIFICADO:
--     · Saúde Financeira          → /dashboard/financeiro/saude         ordem 5  (novo)
--     · Extrato Conta Corrente    → /dashboard/financeiro/extrato       ordem 6  (novo)
--     · Inadimplentes             → /dashboard/financeiro/inadimplentes ordem 7  (novo)
--     · Conciliação Bancária      → /dashboard/financeiro/conciliacao   ordem 15 (rota atualizada)
--   GESTÃO EMPRESARIAL:
--     · Divisões / LDN            → /dashboard/cadastros/divisoes       ordem 16 (renomeado + rota)
--
-- RD-35: 5 features inseridas em feature_catalog · 5 vínculos em screen_route_features.

-- module_catalog: sidebar items
INSERT INTO module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, descricao, layer, is_shared, surface_in_groups)
VALUES
  ('financeiro_saude_ge',
   'Saúde Financeira', 'gestao_empresarial', 'financeiro_unificado', 'activity',
   '/dashboard/financeiro/saude', 5, true,
   'Termômetro consolidado · score 0-100 · 4 indicadores drill-down', 'shared', true,
   ARRAY['gestao_empresarial']::text[]),
  ('financeiro_extrato_ge',
   'Extrato Conta Corrente', 'gestao_empresarial', 'financeiro_unificado', 'list',
   '/dashboard/financeiro/extrato', 6, true,
   'Lançamentos com saldo acumulado · filtros + export CSV', 'shared', true,
   ARRAY['gestao_empresarial']::text[]),
  ('financeiro_inadimplentes_ge',
   'Inadimplentes', 'gestao_empresarial', 'financeiro_unificado', 'alert-circle',
   '/dashboard/financeiro/inadimplentes', 7, true,
   'Inadimplentes agrupados por cliente · WhatsApp + export contador', 'shared', true,
   ARRAY['gestao_empresarial']::text[])
ON CONFLICT (id) DO NOTHING;

UPDATE module_catalog
SET rota = '/dashboard/financeiro/conciliacao'
WHERE id = 'conciliacao_geral';

UPDATE module_catalog
SET nome = 'Divisões / LDN',
    rota = '/dashboard/cadastros/divisoes'
WHERE id = 'ge_cadastros_linhas_negocio';

-- feature_catalog: registro RD-35
INSERT INTO feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto, prioridade)
VALUES
  ('F.financeiro.extrato_conta_corrente', 'financeiro_extrato_ge', 'gestao_empresarial',
   'Extrato Conta Corrente · drill-down + export CSV',
   'Tela com filtros (conta, data, tipo, busca), 4 KPIs (saldo anterior/atual/entradas/saidas) e tabela com saldo acumulado. Export CSV BOM UTF-8. Drill-down em linhas pra contas pagar/receber. PR #165.',
   'pronto', 100, 'alta'),
  ('F.financeiro.inadimplentes_agrupado', 'financeiro_inadimplentes_ge', 'gestao_empresarial',
   'Inadimplentes Agrupados · acoes em massa WhatsApp',
   'RPC fn_ge_inadimplentes_agrupado agrupa erp_receber vencidos por cliente. Cards expansiveis, link WhatsApp com mensagem pre-formatada, email mailto, export CSV contador. PR #166.',
   'pronto', 100, 'alta'),
  ('F.financeiro.saude_financeira', 'financeiro_saude_ge', 'gestao_empresarial',
   'Saude Financeira · score 0-100 + alertas',
   'Termometro consolidado com score 0-100, classificacao BOA/ATENCAO/CRITICA, 4 indicadores drill-down (saldo, meses_caixa, inadimplencia qtd+valor, concentracao receita). PR #162.',
   'pronto', 100, 'alta'),
  ('F.financeiro.conciliacao_quase_la', 'conciliacao_geral', 'gestao_empresarial',
   'Conciliacao Quase La · IA matching OFX',
   'Tres paginas: dashboard saude + inbox pendencias com matches OURO/PRATA/BRONZE + visao lote. fn_conciliacao_aplicar_match em massa. Parser OFX vira PR 14 V2. PR #167.',
   'parcial', 75, 'alta'),
  ('F.cadastros.divisoes_ldn', 'ge_cadastros_linhas_negocio', 'gestao_empresarial',
   'Divisoes / Linhas de Negocio · DRE divisional',
   'CRUD Divisoes (LDN) com cor, ordem, budgets anuais. Alimenta DRE divisional. Rota /cadastros/divisoes nova reusa componente LinhasNegocioList. PR #162.',
   'pronto', 100, 'alta')
ON CONFLICT (id) DO NOTHING;

-- screen_route_features: vinculo tela ↔ feature (RD-35)
-- visibilidade ∈ {primary, secondary, related}
INSERT INTO screen_route_features (screen_id, feature_id, peso, visibilidade)
VALUES
  ('dashboard.financeiro.extrato', 'F.financeiro.extrato_conta_corrente', 1, 'primary'),
  ('dashboard.financeiro.inadimplentes', 'F.financeiro.inadimplentes_agrupado', 1, 'primary'),
  ('dashboard.financeiro.saude', 'F.financeiro.saude_financeira', 1, 'primary'),
  ('dashboard.financeiro.conciliacao', 'F.financeiro.conciliacao_quase_la', 1, 'primary'),
  ('dashboard.cadastros.divisoes', 'F.cadastros.divisoes_ldn', 1, 'primary')
ON CONFLICT DO NOTHING;
