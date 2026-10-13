-- D3 = A (decisão do CEO, 26/09/2026): module_catalog.revenda_veiculo sai de ativo.
--
-- O item apontava /dashboard/revenda/veiculo — rota SEM página raiz desde a criação (02/09, 20260902190000).
-- A tela real é /dashboard/revenda/veiculo/[id]: a ficha é DETALHE, aberta pelo cartão do Pátio, não item de
-- menu. Em 03/09 (20260903130000) virou legacy=true (some do menu) mas seguiu ativo=true. A régua de menu
-- (scripts/check-menu-rotas.ts) só passou a rodar de verdade em 26/09, quando SUPABASE_SERVICE_ROLE_KEY entrou
-- no CI — antes SKIPava com exit 0 — e a primeira execução real acusou o link morto em toda PR.
--
-- Auditado antes (RD-38): nenhum gate de acesso usa module_catalog.ativo (só menu, vínculo a planos e funções
-- de cobertura/drift). plan_modules (21), tenant_modules_active (3) e feature_catalog ficam intactos.
-- Aplicado à mão em produção em 26/09 ~10:10 UTC (execute_sql, OK explícito do CEO); este arquivo reaplica
-- idempotente no deploy. Registro em erp_contexto_projeto (categoria decisao, tag check_menu).

UPDATE public.module_catalog SET ativo = false WHERE id = 'revenda_veiculo' AND ativo = true;
