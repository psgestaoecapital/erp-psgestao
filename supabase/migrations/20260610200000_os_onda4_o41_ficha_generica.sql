-- =============================================================
-- FEAT-OS-ONDA4-O41-FICHA-GENERICA-v1 · Onda 4.1 da trilha OS
-- =============================================================
-- Ordem de Servico (generica) ligada ao pedido.
-- Foundational: serve QUALQUER empresa de comercio + servico ·
-- ZERO referencia a oficina/veiculo/placa.
--
-- Arquitetura:
-- - erp_pedidos (OTC) = motor financeiro/fiscal (intocado)
-- - erp_os = ficha de OS por cima · pedido_id liga ao motor
-- - 1 OS por pedido (idempotente) · next_os_numero() ja existia
--
-- Mudancas:
--   A1) status DEFAULT 'aberta' + CHECK do ciclo
--   A2) fn_os_criar_de_pedido(p_pedido_id) -> jsonb (idempotente)
--   A3) fn_os_salvar(p_os_id, p_dados jsonb) -> jsonb
--       Datas data_execucao / data_conclusao preenchidas automaticas
--       quando status transiciona pra em_execucao / pronta|entregue.
--
-- Migration aplicada via MCP em 2026-06-10.
-- =============================================================

ALTER TABLE erp_os ALTER COLUMN status SET DEFAULT 'aberta';
ALTER TABLE erp_os DROP CONSTRAINT IF EXISTS erp_os_status_check;
ALTER TABLE erp_os ADD CONSTRAINT erp_os_status_check
  CHECK (status IN ('aberta','em_execucao','aguardando_peca','aguardando_aprovacao','pronta','entregue','cancelada'));

CREATE OR REPLACE FUNCTION public.fn_os_criar_de_pedido(p_pedido_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ped erp_pedidos%ROWTYPE;
  v_os  erp_os%ROWTYPE;
  v_numero varchar;
BEGIN
  SELECT * INTO v_ped FROM erp_pedidos WHERE id = p_pedido_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pedido nao encontrado');
  END IF;

  SELECT * INTO v_os FROM erp_os
   WHERE pedido_id = p_pedido_id AND status <> 'cancelada'
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'ja_existia', true,
      'os_id', v_os.id, 'numero', v_os.numero, 'status', v_os.status);
  END IF;

  v_numero := next_os_numero(v_ped.company_id);

  INSERT INTO erp_os (
    company_id, numero, pedido_id, orcamento_origem_id,
    cliente_id, cliente_nome, cliente_cnpj,
    descricao_servico, valor_servico, total,
    status, data_abertura, created_by
  ) VALUES (
    v_ped.company_id, v_numero, p_pedido_id, v_ped.orcamento_origem_id,
    v_ped.cliente_id, v_ped.cliente_nome, v_ped.cliente_cnpj,
    v_ped.observacoes, COALESCE(v_ped.total,0), COALESCE(v_ped.total,0),
    'aberta', CURRENT_DATE, auth.uid()
  ) RETURNING * INTO v_os;

  RETURN jsonb_build_object('ok', true, 'ja_existia', false,
    'os_id', v_os.id, 'numero', v_os.numero, 'status', v_os.status);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_os_salvar(p_os_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_os erp_os%ROWTYPE;
  v_novo_status text := p_dados->>'status';
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada');
  END IF;

  IF v_novo_status IS NOT NULL AND v_novo_status NOT IN
     ('aberta','em_execucao','aguardando_peca','aguardando_aprovacao','pronta','entregue','cancelada') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Status invalido');
  END IF;

  UPDATE erp_os SET
    equipamento          = COALESCE(p_dados->>'equipamento', equipamento),
    defeito_relatado     = COALESCE(p_dados->>'defeito_relatado', defeito_relatado),
    descricao_servico    = COALESCE(p_dados->>'descricao_servico', descricao_servico),
    endereco_servico     = COALESCE(p_dados->>'endereco_servico', endereco_servico),
    observacoes_cliente  = COALESCE(p_dados->>'observacoes_cliente', observacoes_cliente),
    observacoes_internas = COALESCE(p_dados->>'observacoes_internas', observacoes_internas),
    status               = COALESCE(v_novo_status, status),
    data_execucao        = CASE WHEN v_novo_status='em_execucao' AND data_execucao IS NULL THEN CURRENT_DATE ELSE data_execucao END,
    data_conclusao       = CASE WHEN v_novo_status IN ('pronta','entregue') AND data_conclusao IS NULL THEN CURRENT_DATE ELSE data_conclusao END,
    updated_at           = now()
  WHERE id = p_os_id RETURNING * INTO v_os;

  RETURN jsonb_build_object('ok', true, 'os_id', v_os.id, 'status', v_os.status);
END; $$;

GRANT EXECUTE ON FUNCTION public.fn_os_criar_de_pedido(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_os_salvar(uuid, jsonb)   TO authenticated;
