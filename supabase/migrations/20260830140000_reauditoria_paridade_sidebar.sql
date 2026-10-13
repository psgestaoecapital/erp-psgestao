-- REAUDITORIA paridade OMIE (CEO 30/08): o motor está 100% no banco, mas 4 telas novas não aparecem na
-- sidebar da área que a KGF usa (Gestão Empresarial), e o Livro está com badge mentiroso "Previsto".
-- Auditei a RPC real fn_modulos_sidebar_por_area: módulo compartilhado só aparece em outra área quando
-- is_shared=true E surface_in_groups @> [area]; e o badge vem de feature_catalog.status (default 'previsto').

-- ── P1 · colocar Reforma e Livro na Gestão Empresarial (surface_in_groups) ───────────────────────────
UPDATE public.module_catalog
   SET surface_in_groups = ARRAY['gestao_empresarial','commerce']
 WHERE id IN ('reforma_tributaria_2026','commerce_livro_entradas');

-- ── P2 · registrar as 2 telas órfãs (só se chegava por URL): Precificação em massa e Config de custo ──
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, is_shared, legacy, vertical_specific, surface_in_groups, dependencies)
VALUES
 ('commerce_precificacao', 'Precificação em massa', 'commerce', 'compras', 'Tags', '/dashboard/compras/precificacao', 184, true, true, false, ARRAY['commerce','industrial','hub'], ARRAY['gestao_empresarial','commerce'], ARRAY[]::text[]),
 ('commerce_custo_config', 'Config de custo', 'commerce', 'compras', 'SlidersHorizontal', '/dashboard/compras/custo-config', 185, true, true, false, ARRAY['commerce','industrial','hub'], ARRAY['gestao_empresarial','commerce'], ARRAY[]::text[])
ON CONFLICT (id) DO UPDATE SET ativo=true, surface_in_groups=ARRAY['gestao_empresarial','commerce'], rota=EXCLUDED.rota, subgrupo='compras';

-- ativar por tenant p/ a KGF (idempotente)
INSERT INTO public.tenant_modules_active (company_id, module_id, is_active, override_reason, activated_at)
SELECT 'a462e13f-0f51-4c54-abe8-4474b591633b', m, true, 'reauditoria paridade OMIE 30/08', now()
FROM unnest(ARRAY['commerce_precificacao','commerce_custo_config']) AS m
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_modules_active t WHERE t.company_id='a462e13f-0f51-4c54-abe8-4474b591633b' AND t.module_id=m);
UPDATE public.tenant_modules_active SET is_active=true, deactivated_at=NULL
 WHERE company_id='a462e13f-0f51-4c54-abe8-4474b591633b' AND module_id IN ('commerce_precificacao','commerce_custo_config');

-- ── P3 · badge honesto: as telas existem e funcionam → status 'pronto' no feature_catalog (RD-58) ─────
-- (o Livro não tinha linha → caía no default 'previsto'.)
INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto, prioridade)
VALUES
 ('F.commerce.livro_entradas', 'commerce_livro_entradas', 'fiscal', 'Livro de Entradas', 'Livro fiscal de entradas por CFOP, com base e ICMS, exportável (CSV/PDF) e rastro em exportacoes_sped.', 'pronto', 100, 'alta'),
 ('F.commerce.precificacao', 'commerce_precificacao', 'commerce', 'Precificação em massa', 'Preço de venda por margem líquida real (após imposto, comissão e custo fixo), em lote.', 'pronto', 100, 'alta'),
 ('F.commerce.custo_config', 'commerce_custo_config', 'commerce', 'Config de custo', 'Configuração de custo de estoque por natureza + imposto/comissão da venda.', 'pronto', 100, 'alta')
ON CONFLICT (id) DO UPDATE SET status='pronto', percentual_pronto=100;

-- ── P4 · remover a sobrecarga antiga de fn_fiscal_exportacao_registrar (7 args, sem p_conteudo) ───────
-- A versão com md5 no servidor (8 args, com p_conteudo) é a chamada pela tela; a de 7 args virou ambígua.
DROP FUNCTION IF EXISTS public.fn_fiscal_exportacao_registrar(uuid, text, text, text, integer, integer, text);
