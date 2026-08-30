-- Follow-up da reauditoria (CEO 30/08), 2 tarefas.

-- ══ TAREFA 1 · registrar no menu o Mutirão (fila das 208 notas) e Margem Negativa (54 produtos no prejuízo)
-- A Jordana precisa achar as duas sem depender de link. a-chegar e custo-simulacao ficam contextuais (decisão CEO).
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, is_shared, legacy, vertical_specific, surface_in_groups, dependencies)
VALUES
 ('commerce_mutirao', 'Mutirão de notas', 'commerce', 'compras', 'ClipboardCheck', '/dashboard/compras/mutirao', 183, true, true, false, ARRAY['commerce','industrial','hub'], ARRAY['gestao_empresarial','commerce'], ARRAY[]::text[]),
 ('commerce_margem_negativa', 'Vendendo abaixo do custo', 'commerce', 'compras', 'TrendingDown', '/dashboard/compras/margem-negativa', 186, true, true, false, ARRAY['commerce','industrial','hub'], ARRAY['gestao_empresarial','commerce'], ARRAY[]::text[])
ON CONFLICT (id) DO UPDATE SET ativo=true, surface_in_groups=ARRAY['gestao_empresarial','commerce'], rota=EXCLUDED.rota, subgrupo='compras';

INSERT INTO public.tenant_modules_active (company_id, module_id, is_active, override_reason, activated_at)
SELECT 'a462e13f-0f51-4c54-abe8-4474b591633b', m, true, 'reauditoria paridade OMIE 30/08', now()
FROM unnest(ARRAY['commerce_mutirao','commerce_margem_negativa']) AS m
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_modules_active t WHERE t.company_id='a462e13f-0f51-4c54-abe8-4474b591633b' AND t.module_id=m);
UPDATE public.tenant_modules_active SET is_active=true, deactivated_at=NULL
 WHERE company_id='a462e13f-0f51-4c54-abe8-4474b591633b' AND module_id IN ('commerce_mutirao','commerce_margem_negativa');

INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto, prioridade)
VALUES
 ('F.commerce.mutirao', 'commerce_mutirao', 'commerce', 'Mutirão de notas', 'Fila de conferência das notas recebidas + casamento exato de lote + conferência em série.', 'pronto', 100, 'alta'),
 ('F.commerce.margem_negativa', 'commerce_margem_negativa', 'commerce', 'Vendendo abaixo do custo', 'Produtos com preço de venda abaixo do custo real (margem negativa).', 'pronto', 100, 'alta')
ON CONFLICT (id) DO UPDATE SET status='pronto', percentual_pronto=100;

-- ══ TAREFA 2 · badge determinístico e honesto (RD-58) ═══════════════════════════════════════════════
-- A RPC fn_modulos_sidebar_por_area escolhia o status do módulo com `feature_catalog ... LIMIT 1` SEM
-- ORDER BY — sorte pura. Auditado: 19 módulos ativos têm múltiplas linhas com status conflitantes, então
-- é sorte para todos. Em vez de uma régua (que sinalizaria 19 módulos legítimos), corrigimos a RAIZ: o
-- badge vira um ROLLUP — 'pronto' só se TODAS as features prontas; 'parcial' se há parte pronta/parcial;
-- 'previsto' se nada (ou sem feature). Determinístico e não mente (RD-58). Feito por replace seguro do
-- subselect na definição viva da função (com guarda de nº de ocorrências), pra não transcrever ~100 linhas.
DO $mig$
DECLARE
  v_def text;
  v_old text := '(SELECT fc.status FROM feature_catalog fc WHERE fc.module_id = mc.id LIMIT 1)';
  v_new text := '(SELECT CASE WHEN count(*)=0 THEN ''previsto'' WHEN count(*) FILTER (WHERE fc.status=''pronto'')=count(*) THEN ''pronto'' WHEN count(*) FILTER (WHERE fc.status IN (''pronto'',''parcial'',''em_construcao''))>0 THEN ''parcial'' ELSE ''previsto'' END FROM feature_catalog fc WHERE fc.module_id = mc.id)';
  v_ocorrencias int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='fn_modulos_sidebar_por_area' LIMIT 1;
  IF v_def IS NULL THEN RAISE EXCEPTION 'fn_modulos_sidebar_por_area não encontrada — abortando'; END IF;
  v_ocorrencias := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_ocorrencias <> 6 THEN
    RAISE EXCEPTION 'esperava 6 ocorrências do LIMIT 1 na função, encontrei %; a definição mudou — abortando pra revisão', v_ocorrencias;
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $mig$;
