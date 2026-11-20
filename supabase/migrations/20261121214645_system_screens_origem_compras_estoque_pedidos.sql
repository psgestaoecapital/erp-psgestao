-- RD-98 p3 (origem do dado) — preenche system_screens.views_consumidas / rpcs_chamadas de 3 telas
-- da área de commerce/compras que estavam NULL. Code: desenvolvedor_4_g.
--
-- MÉTODO (RD-38): grep de .from/.rpc nas páginas, confirmado em pg_class/pg_proc. Array vazio = tela
-- VERIFICADA sem fonte de dado própria (ex.: stub de redirect), distinto de NULL (não-verificado).
--
-- 1) /dashboard/compras: stub de permanentRedirect(308) para /dashboard/commerce/compras
--    (FIX-NAV-COMMERCE-EM-GE-v1); não lê dado. => views={}, rpcs={}.
-- 2) /dashboard/estoque: idem, redireciona para /dashboard/commerce/estoque. => views={}, rpcs={}.
-- 3) /dashboard/pedidos (564 linhas, UI real): lê erp_pedidos, erp_pedidos_itens, erp_orcamentos,
--    erp_lancamentos; chama os RPCs converter_orcamento_pedido e fn_pedido_editar_itens
--    (todos confirmados em pg_class/pg_proc).
--
-- Aditiva/idempotente: só preenche onde está NULL (não sobrescreve classificação já feita).
-- Toca apenas metadados de catálogo global (system_screens); não dado de cliente, não RLS/permissão.

UPDATE public.system_screens
   SET views_consumidas = ARRAY[]::text[],
       rpcs_chamadas    = ARRAY[]::text[]
 WHERE rota IN ('/dashboard/compras','/dashboard/estoque')
   AND views_consumidas IS NULL
   AND rpcs_chamadas IS NULL;

UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_pedidos','erp_pedidos_itens','erp_orcamentos','erp_lancamentos']::text[],
       rpcs_chamadas    = ARRAY['converter_orcamento_pedido','fn_pedido_editar_itens']::text[]
 WHERE rota = '/dashboard/pedidos'
   AND views_consumidas IS NULL
   AND rpcs_chamadas IS NULL;
