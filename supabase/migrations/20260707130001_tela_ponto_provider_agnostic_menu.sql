-- FEATURE-TELA-PONTO (07/07 · diretriz CEO cristalizada em erp_contexto_projeto):
-- "Dados de ponto em tabela UNICA provider-agnostic (IO Point, Pontotel,
--  Dominio). Expostos em TELA dentro de INDUSTRIAL (plano industrial) E
--  dentro de COMPLIANCE (plano compliance) — mesma fonte, duas lentes,
--  com todo o historico. Finalidade: BI por area, irrigar modulos,
--  cruzamentos RH x Producao."
--
-- Este SQL: registro da diretriz + menu (module_catalog) + gating
-- (plan_modules). Telas em src/components/ponto/PontoView.tsx (compartilhada)
-- + pages /dashboard/industrial/ponto e /dashboard/compliance/ponto.
-- Aplicada via MCP apply_migration em 2026-07-07 (success:true).

-- 1) Cristalizar diretriz CEO
INSERT INTO public.erp_contexto_projeto
  (projeto, categoria, prioridade, status, titulo, descricao, tags, criado_por)
VALUES
  ('erp_psgestao', 'arquitetura', 'alta', 'ativo',
   'Ponto eletronico provider-agnostic · tabela unica, duas lentes',
$$DIRETRIZ CEO 07/07: Dados de ponto em tabela UNICA provider-agnostic (qualquer fornecedor: IO Point, Pontotel, Dominio) — ind_ponto_colaborador + ind_ponto_horas + ind_ponto_provider_config. Expostos em TELA dentro de INDUSTRIAL (se empresa tem plano industrial) E dentro de COMPLIANCE (se tem plano compliance) — mesma fonte, duas lentes, com TODO o historico. Finalidade: BI por area, irrigar modulos (compliance_funcionarios via fn_compliance_projetar_de_ind_ponto), cruzamentos (RH x Producao). Gating por plan_modules. Telas: /dashboard/industrial/ponto (lente industrial: sync + colaboradores + horas) e /dashboard/compliance/ponto (lente compliance: mesmos dados + botao Importar pro Compliance).$$,
   ARRAY['ponto-eletronico','provider-agnostic','iopoint','industrial','compliance','irrigacao','diretriz-ceo'],
   'claude');

-- 2) Modulo industrial (ja existia · ajustar surface + garantir ativo)
UPDATE public.module_catalog
SET surface_in_groups = ARRAY['industrial'],
    subgrupo = COALESCE(subgrupo, 'operacao'),
    ativo = true
WHERE id = 'industrial_ponto_eletronico';

-- 3) Modulo compliance (lente espelho)
INSERT INTO public.module_catalog (id, nome, rota, grupo, subgrupo, ordem, ativo, surface_in_groups)
VALUES ('compliance_ponto', 'Ponto Eletrônico', '/dashboard/compliance/ponto',
        'compliance', 'docs_regulatorios', 15, true, ARRAY['compliance'])
ON CONFLICT (id) DO UPDATE
SET rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, subgrupo = EXCLUDED.subgrupo,
    surface_in_groups = EXCLUDED.surface_in_groups, ativo = true;

-- 4) Gating por plano
INSERT INTO public.plan_modules (plan_id, module_id, is_default_active)
SELECT p.plan_id, p.module_id, true
FROM (VALUES
  ('v15_industrial_pequena', 'industrial_ponto_eletronico'),
  ('v15_industrial_media',   'industrial_ponto_eletronico'),
  ('v15_industrial_grande',  'industrial_ponto_eletronico'),
  ('v15_compliance',         'compliance_ponto')
) p(plan_id, module_id)
ON CONFLICT DO NOTHING;

-- Verificacao empirica: Frioeste tem v15_industrial_grande + v15_compliance
-- ativos -> ve as DUAS lentes. Tryo/M.m/R.R (so v15_compliance) -> so a
-- lente compliance.
