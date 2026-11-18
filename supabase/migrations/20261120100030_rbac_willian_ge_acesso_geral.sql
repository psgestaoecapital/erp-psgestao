-- CEO 18/11: acesso GERAL à Gestão Empresarial para o Willian (FC Pisos, compras@fcpisos.com). O papel dedicado
-- hub_compras_financeiro (exclusivo do Willian) já libera na GE: financeiro, compras, cadastros, estoque. Aqui
-- somam-se as DEMAIS seções OPERACIONAIS da GE que a FC Pisos paga: análises, contratos & vendas,
-- inteligência & proteção, notas fiscais, PDV, vendas. Só afeta o Willian (papel dedicado). Aditivo/idempotente.
--
-- Provado no dado (RD-38, BEGIN..ROLLBACK): as seções da GE do Willian vão de 5 → 11 (ganha ANALISES,
-- CONTRATOS_VENDAS, INTELIGENCIA_PROTECAO, NOTAS_FISCAIS, PDV, VENDAS). Todos são subgrupos REAIS da GE
-- (grupo=gestao_empresarial) e pagos pela FC Pisos. RD-25 (acesso de cliente) → MERGE AUTORIZADO.
--
-- NÃO incluídos de propósito (3 itens do pedido original que a auditoria no dado reprovou — ver PR/flag ao CEO):
--   • administracao  → NÃO é só "config da GE": a seção inclui convidar_usuarios (criar contas), admin_trilha_auditoria,
--     admin_certificado_a1 (certificado fiscal), admin_painel, admin_conectores_erp — ESCALAÇÃO de privilégio para um
--     usuário de compras. Precisa de decisão explícita do CEO (foi excluída também no #5386).
--   • contabilidade  → grupo='contador', NÃO é da GE (gestao_empresarial) → grant inerte para o menu da GE.
--   • pm_comercial   → subgrupo primário do PM (projetos), não da GE → mexeria no menu do Hub/PM, fora do escopo "GE".

INSERT INTO public.rbac_papel_acesso (papel_slug, subgrupo, nivel) VALUES
  ('hub_compras_financeiro', 'analises', 'editar'),
  ('hub_compras_financeiro', 'contratos_vendas', 'editar'),
  ('hub_compras_financeiro', 'inteligencia_protecao', 'editar'),
  ('hub_compras_financeiro', 'notas_fiscais', 'editar'),
  ('hub_compras_financeiro', 'pdv', 'editar'),
  ('hub_compras_financeiro', 'vendas', 'editar')
ON CONFLICT (papel_slug, subgrupo) DO NOTHING;
