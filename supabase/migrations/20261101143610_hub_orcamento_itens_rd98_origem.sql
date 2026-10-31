-- RD-98 pilar 3 (ORIGEM DO DADO) — /dashboard/hub/orcamento-itens estava com
-- system_screens.views_consumidas / rpcs_chamadas VAZIOS (gap do auditor).
-- Listas do grep real .from()/.rpc() de src/app/dashboard/hub/orcamento-itens/page.tsx.
--
-- Prova (RD-38, produção, BEGIN/ROLLBACK, statement_timeout 15s): a rota existe em system_screens
-- com a origem vazia; as 6 RPCs existem em pg_proc (6/6); erp_orcamentos é tabela conhecida.
--
-- ADITIVA e metadado-only: só UPDATE de system_screens. Nenhuma tabela, RLS, policy, função ou
-- dado de cliente. Idempotente (WHERE só atinge a origem ainda vazia).
UPDATE public.system_screens
SET views_consumidas = ARRAY['erp_orcamentos']::text[],
    rpcs_chamadas    = ARRAY['fn_orcamento_item_listar','fn_orcamento_item_adicionar','fn_orcamento_item_editar','fn_orcamento_item_excluir','fn_orcamento_contrato_servicos','fn_orcamento_preco_sugerido']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/hub/orcamento-itens'
  AND coalesce(array_length(views_consumidas,1),0) = 0
  AND coalesce(array_length(rpcs_chamadas,1),0) = 0;
