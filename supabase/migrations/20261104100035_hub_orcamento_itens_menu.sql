-- PDCA Hub · /dashboard/hub/orcamento-itens (aud8 82/95)
-- Gap crítico RD-98 (MENU): a rota NÃO está em module_catalog, então a tela "Itens do
-- Orçamento" não aparece no menu e o usuário não a enxerga. Esta migration insere a linha
-- do menu (grupo hub, subgrupo projetos_comercial — ao lado de "Orçamentos"), ativa, com
-- nome próprio (RD-100: sem nome de terceiro).
--
-- Aditiva e idempotente: ON CONFLICT (id) reativa/atualiza sem duplicar. Não toca dado de
-- cliente nem a estrutura do menu (layout/catálogo). system_screens da rota já está
-- preenchido (views_consumidas/rpcs_chamadas) e a RD-95 ("?") já foi entregue na #3837.
--
-- Prova RD-38 (BEGIN/ROLLBACK em produção, sem mutação):
--   antes = 0 linha para a rota  →  depois = 1 (ativa)  →  reexecução = 1 (idempotente).

INSERT INTO module_catalog (id, nome, grupo, subgrupo, rota, ordem, ativo, icone, descricao, is_shared)
VALUES (
  'hub_orcamento_itens',
  'Itens do Orçamento',
  'hub',
  'projetos_comercial',
  '/dashboard/hub/orcamento-itens',
  114,
  true,
  'ListChecks',
  'Monte e ajuste os itens de um orçamento: inclua, edite e exclua serviços e produtos com recálculo automático do total.',
  true
)
ON CONFLICT (id) DO UPDATE
  SET nome      = EXCLUDED.nome,
      grupo     = EXCLUDED.grupo,
      subgrupo  = EXCLUDED.subgrupo,
      rota      = EXCLUDED.rota,
      ordem     = EXCLUDED.ordem,
      ativo     = true,
      icone     = EXCLUDED.icone,
      descricao = EXCLUDED.descricao,
      is_shared = EXCLUDED.is_shared;
