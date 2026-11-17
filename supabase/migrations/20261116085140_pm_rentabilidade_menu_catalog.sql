-- PDCA PM · /dashboard/pm/rentabilidade · menu ausente do module_catalog (aud8 94/95 → 96+)
-- GAP (RD-38, provado no banco horsymhsinqcimflrtjo): a rota /dashboard/pm/rentabilidade
-- NÃO constava em module_catalog, enquanto as telas-irmãs de análise do PM
-- (pm/margem-job e pm/contratado-realizado) constam e estão ativas. Quem navega pelo MENU
-- não achava "Rentabilidade" — só chegava pelo link do hub /dashboard/pm. Critério "o
-- usuário faz sozinho" travava a nota em 94.
--
-- Correção: INSERT ADITIVO e IDEMPOTENTE espelhando pm_contratado_realizado
-- (mesmo grupo/subgrupo/layer PM). Nenhum dado de cliente é tocado. module_catalog é
-- catálogo global de menu (sem company_id, sem RLS por empresa) — só define o item de menu.
--
-- Prova RD-38 (BEGIN…ROLLBACK na produção, idempotência conferida):
--   antes = 0; após 1º INSERT = 1; após 2º INSERT (ON CONFLICT) = 1 (não duplica).

INSERT INTO public.module_catalog
  (id, nome, grupo, icone, rota, ordem, ativo, descricao, layer, vertical_specific, is_shared, dependencies, subgrupo)
VALUES
  ('pm_rentabilidade', 'Rentabilidade', 'pm', 'TrendingUp', '/dashboard/pm/rentabilidade', 92, true,
   'Rentabilidade por cliente da agência: receita, custos diretos, indiretas rateadas e margem, com as despesas sem classificação sinalizadas para você distribuir.',
   '3_specific', ARRAY['pm']::text[], false, ARRAY[]::text[], 'pm_producao')
ON CONFLICT (id) DO NOTHING;
