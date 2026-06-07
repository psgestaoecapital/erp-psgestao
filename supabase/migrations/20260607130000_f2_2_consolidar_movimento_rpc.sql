-- =============================================================
-- SPEC-F2-ESTOQUE-v1 · F2.2 · consolidacao de RPCs duplicadas
-- =============================================================
-- Existem 2 RPCs de movimento de estoque:
--   - fn_movimentar_estoque(produto, local, tipo, qtd, custo, motivo,
--       observacoes, ref_tipo, ref_id, ref_numero, lote, validade)
--     -> tem lote+validade · SEM usuario_id (LGPD/Pilar 2 incompleto)
--   - registrar_movimento_estoque(company_id, produto, tipo, qtd, custo,
--       motivo, ref_tipo, ref_id, ref_numero, observacoes,
--       usuario_id, local_id)
--     -> tem usuario_id (rastreio LGPD) · sem lote+validade
--
-- Elegemos registrar_movimento_estoque por causa do usuario_id.
-- fn_movimentar_estoque fica DEPRECATED · sem deletar (compat reversa).
-- Adicionar lote/validade na funcao eleita fica como gap conhecido
-- pra uma F2.3 futura.
-- =============================================================

COMMENT ON FUNCTION public.fn_movimentar_estoque(
  uuid, uuid, text, numeric, numeric, text, text, text, uuid, text, text, date
) IS
  '[DEPRECATED · F2.2] · Use public.registrar_movimento_estoque (tem usuario_id pra rastreio LGPD). Esta funcao permanece pra compatibilidade reversa · nao usar em novos caminhos.';

COMMENT ON FUNCTION public.registrar_movimento_estoque(
  uuid, uuid, character varying, numeric, numeric, character varying,
  character varying, uuid, character varying, text, uuid, uuid
) IS
  'F2.2 · RPC eleita pra movimentacoes de estoque. Inclui usuario_id pra
rastreio LGPD. Gap conhecido: nao tem lote/validade · adicionar como
parametros opcionais na F2.3 quando for necessario.';
