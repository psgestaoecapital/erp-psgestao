-- RD-41 Fase 1.1 · Bloco D — desvincular reseta o MOVIMENTO
-- (unifica modelo de vinculo). A RPC existente referenciava colunas
-- conciliado/movimento_banco_id que nao existiam em erp_pagar/erp_receber
-- (RPC ficava quebrada em runtime). Adiciono as colunas p/ desbloquear o
-- modelo unificado + reescrevo a funcao para tambem resetar o proprio
-- conciliacao_movimento (o trigger trg_baixa_por_conciliacao cuida do
-- estorno idempotente da baixa no titulo).
-- Aplicada via MCP em 2026-07-02.

ALTER TABLE public.erp_pagar
  ADD COLUMN IF NOT EXISTS conciliado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS movimento_banco_id uuid;

ALTER TABLE public.erp_receber
  ADD COLUMN IF NOT EXISTS conciliado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS movimento_banco_id uuid;

CREATE OR REPLACE FUNCTION public.fn_conciliacao_desvincular(
  p_lancamento_id uuid,
  p_tipo          text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tabela text := 'erp_' || p_tipo;
  v_mov_count int := 0;
BEGIN
  IF p_tipo NOT IN ('pagar','receber') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'tipo_invalido');
  END IF;

  UPDATE public.conciliacao_movimento
     SET status = 'pendente',
         lancamento_tabela = NULL,
         lancamento_id = NULL,
         match_score = NULL,
         match_origem = NULL,
         match_aplicado_em = NULL,
         match_aplicado_por = NULL,
         updated_at = now()
   WHERE lancamento_id = p_lancamento_id
     AND lancamento_tabela = v_tabela
     AND company_id IN (SELECT get_user_company_ids());
  GET DIAGNOSTICS v_mov_count = ROW_COUNT;

  IF p_tipo = 'pagar' THEN
    UPDATE public.erp_pagar
       SET conciliado = false,
           movimento_banco_id = NULL,
           updated_at = now()
     WHERE id = p_lancamento_id;
  ELSE
    UPDATE public.erp_receber
       SET conciliado = false,
           movimento_banco_id = NULL,
           updated_at = now()
     WHERE id = p_lancamento_id;
  END IF;

  RETURN jsonb_build_object(
    'sucesso', true,
    'movimentos_resetados', v_mov_count,
    'lancamento_id', p_lancamento_id,
    'tipo', p_tipo
  );
END $$;
