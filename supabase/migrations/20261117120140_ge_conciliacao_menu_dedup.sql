-- PDCA GE · /dashboard/financeiro/conciliacao · GAP único (menu limpo, princípio 3) — auditor_pdca_2 15/11
-- Code: code-desenvolvedor-3
--
-- PROBLEMA (provado no dado, RD-38): QUATRO linhas ATIVAS em module_catalog caem todas na MESMA
-- tela de Conciliação Bancária (entrypoint canônico /dashboard/financeiro/conciliacao -> /inbox):
--   id=conciliacao_geral          · grupo erp_core            · rota /dashboard/financeiro/conciliacao        (CANÔNICA, layer core, is_shared)
--   id=ge_financeiro_conciliacao  · grupo gestao_empresarial  · rota /dashboard/conciliacao                   (redirect)
--   id=bpo_conciliacao_bancaria   · grupo bpo                 · rota /dashboard/bpo/conciliacao               (redirect)
--   id=pm_fin_conciliacao         · grupo pm                  · rota /dashboard/financeiro/conciliacao/inbox  (tela real, item próprio)
-- A entrada canônica conciliacao_geral já é is_shared=true e surface_in_groups inclui bpo, gestao_empresarial,
-- commerce, services, custeio_a — então ela JÁ aparece nesses menus. As entradas por grupo acima DUPLICAM o
-- item (ex.: em gestao_empresarial aparecem 2 itens de conciliação). É exatamente a poluição de menu reclamada.
--
-- FIX (aditivo + idempotente, sem tocar dado de cliente):
--  1. Mantém UMA entrada canônica no menu: conciliacao_geral -> /dashboard/financeiro/conciliacao (URL curta;
--     o redirect leva ao /inbox, a tela real com AjudaCampo/parser OFX/auto-conciliação).
--  2. Acrescenta 'pm' a surface_in_groups da canônica. A tela de conciliação do P&M hoje vem da entrada nativa
--     pm_fin_conciliacao; ao desativá-la (passo 3) o P&M PERDERIA o item. Surfaçando a canônica no 'pm'
--     (is_shared=true AND surface_in_groups @> ARRAY['pm'] AND grupo != 'pm'), a RPC fn_modulos_sidebar_por_area
--     volta a mostrar 1 item de conciliação no P&M — sem regressão (princípio 5).
--  3. DESATIVA (ativo=false) as 3 entradas duplicadas: pm_fin_conciliacao, ge_financeiro_conciliacao,
--     bpo_conciliacao_bancaria. As ROTAS de redirect permanecem no código (deep-links e defesa em
--     profundidade) — apenas saem do MENU. Linhas preservadas/reversíveis (não há DELETE de config).
--
-- module_catalog é configuração GLOBAL (não tem company_id, não é dado de cliente). A RPC do menu só lê
-- ativo=true, então as duplicatas somem do menu. Nenhum código em src/ referencia esses ids (só as migrations
-- que os criaram). Idempotente: reexecução grava os mesmos valores.
--
-- PROVA RD-38 (BEGIN/ROLLBACK, antes do PR):
--  • raw module_catalog '%conciliac%': ativos 4 -> 1 (sobra só conciliacao_geral).
--  • fn_modulos_sidebar_por_area por área (company/user NULL), itens de conciliação ANTES -> DEPOIS:
--      gestao_empresarial 2 -> 1 (dedup); bpo 1 -> 1; pm 1 -> 1 (canônica surfaça no lugar da nativa);
--      commerce/services/custeio_a 1 -> 1. Nenhuma área fica com 0 (sem regressão), gestao_empresarial dedupa.

-- 2) acrescenta 'pm' à cobertura da canônica (preserva as áreas atuais)
UPDATE public.module_catalog
   SET surface_in_groups = ARRAY['custeio_a','services','bpo','gestao_empresarial','commerce','pm']::text[]
 WHERE id = 'conciliacao_geral';

-- 3) desativa as 3 duplicatas (reversível; somem do menu, rotas de redirect seguem no código)
UPDATE public.module_catalog
   SET ativo = false
 WHERE id IN ('pm_fin_conciliacao','ge_financeiro_conciliacao','bpo_conciliacao_bancaria')
   AND ativo = true;
