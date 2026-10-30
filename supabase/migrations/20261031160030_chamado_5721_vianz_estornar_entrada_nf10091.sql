-- Chamado #5721 (Vianz) — estorno pontual da entrada da NF-e 10091 (RP Peças, R$ 3.000)
-- Mercadoria veio errada; devolução feita fora do ERP. Autorizado pelo Rodrigo (ok_socio aprovado 30/10 16:15,
-- ampliado na mensagem 57f4b25b). Sem documento fiscal. Escopo: company_id da Vianz, uma nota, um título, um movimento.
-- Idempotente: só age se a nota ainda está "completo"/lançada e o título segue aberto, sem pagamento nem conciliação.
-- Code: rodrigo-code
CREATE TABLE IF NOT EXISTS erp_backup_chamado_5721 (
  id bigserial PRIMARY KEY,
  tabela text NOT NULL,
  registro_id uuid NOT NULL,
  company_id uuid NOT NULL,
  antes jsonb NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE erp_backup_chamado_5721 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON erp_backup_chamado_5721 FROM anon, authenticated;

DO $mig$
DECLARE
  c_company constant uuid := '64400871-b402-4d55-abcd-450e0b88ed92';
  c_nota    constant uuid := '6dafdcb9-b743-45c7-b5bc-2fba0435c7cf';
  c_pagar   constant uuid := 'c4ce222a-a464-4ccf-b7d4-312b89ab4b87';
  c_prod    constant uuid := '6c06a52f-98d1-4225-bc5e-a2da98e00bf2';
  n erp_nfe_recebidas%ROWTYPE; p erp_pagar%ROWTYPE; m erp_estoque_movimentacoes%ROWTYPE; pr erp_produtos%ROWTYPE;
BEGIN
  SELECT * INTO n FROM erp_nfe_recebidas WHERE id = c_nota AND company_id = c_company FOR UPDATE;
  IF NOT FOUND OR n.estoque_status <> 'completo' OR NOT COALESCE(n.lancado_pagar,false) THEN
    RAISE NOTICE '#5721: nota 10091 ausente ou já estornada — nada a fazer'; RETURN;
  END IF;
  SELECT * INTO p FROM erp_pagar WHERE id = c_pagar AND company_id = c_company FOR UPDATE;
  IF NOT FOUND OR p.status <> 'aberto' OR COALESCE(p.valor_pago,0) <> 0 OR p.data_pagamento IS NOT NULL
     OR COALESCE(p.conciliado,false) OR p.movimento_banco_id IS NOT NULL THEN
    RAISE NOTICE '#5721: título mudou (pago/conciliado/não aberto) — NÃO mexer, avisar o Rodrigo'; RETURN;
  END IF;
  SELECT * INTO m FROM erp_estoque_movimentacoes
   WHERE ref_id = c_nota AND ref_tipo = 'nfe_recebida' AND company_id = c_company AND produto_id = c_prod AND tipo = 'entrada';
  SELECT * INTO pr FROM erp_produtos WHERE id = c_prod AND company_id = c_company FOR UPDATE;
  IF m.id IS NULL OR pr.id IS NULL OR pr.estoque_atual < m.quantidade THEN
    RAISE NOTICE '#5721: movimento ausente ou itens já consumidos (estoque ficaria negativo) — NÃO mexer'; RETURN;
  END IF;

  -- backup antes
  INSERT INTO erp_backup_chamado_5721(tabela, registro_id, company_id, antes) VALUES
    ('erp_nfe_recebidas', n.id, c_company, to_jsonb(n) - 'xml_raw'),
    ('erp_pagar', p.id, c_company, to_jsonb(p)),
    ('erp_estoque_movimentacoes', m.id, c_company, to_jsonb(m)),
    ('erp_produtos', pr.id, c_company, jsonb_build_object('estoque_atual', pr.estoque_atual, 'preco_custo_medio', pr.preco_custo_medio)),
    ('erp_nfe_recebidas_itens', n.id, c_company,
       (SELECT COALESCE(jsonb_agg(to_jsonb(i)), '[]'::jsonb) FROM erp_nfe_recebidas_itens i WHERE i.nfe_recebida_id = n.id)),
    ('erp_nfe_recebidas_duplicatas', n.id, c_company,
       (SELECT COALESCE(jsonb_agg(to_jsonb(d)), '[]'::jsonb) FROM erp_nfe_recebidas_duplicatas d WHERE d.nfe_recebida_id = n.id));

  -- 1) estoque: movimento de saída de estorno (com rastro e motivo)
  PERFORM fn_movimentar_estoque(
    p_produto_id := c_prod, p_local_id := m.local_id, p_tipo := 'saida', p_quantidade := m.quantidade,
    p_custo_unitario := m.custo_unitario,
    p_motivo := 'Estorno entrada NF-e 10091 — mercadoria veio errada, devolução feita fora do ERP',
    p_observacoes := 'Chamado #5721 · autorizado pelo sócio · estorno do movimento ' || m.id,
    p_ref_tipo := 'estorno_nfe_recebida', p_ref_id := c_nota, p_ref_numero := n.numero);
  UPDATE erp_produtos SET preco_custo_medio = pr.preco_custo_medio WHERE id = c_prod;  -- custo médio como estava

  -- 2) título a pagar
  UPDATE erp_pagar SET status = 'cancelado', updated_at = now(),
         observacoes = COALESCE(observacoes,'') || ' | Cancelado: estorno da entrada NF-e 10091, mercadoria veio errada (chamado #5721)'
   WHERE id = c_pagar AND company_id = c_company;

  -- 2b) duplicata da nota deixa de apontar para o título cancelado; libera as chaves do título cancelado para um novo lançamento
  UPDATE erp_nfe_recebidas_duplicatas SET pagar_id = NULL
   WHERE nfe_recebida_id = c_nota AND company_id = c_company AND pagar_id = c_pagar;
  UPDATE erp_pagar SET import_hash = import_hash || ':estornado', ref_externa_id = ref_externa_id || ':estornado'
   WHERE id = c_pagar AND company_id = c_company;

  -- 3) itens e nota voltam ao estado anterior
  UPDATE erp_nfe_recebidas_itens SET estoque_movimentado = false, movimentacao_id = NULL
   WHERE nfe_recebida_id = c_nota AND company_id = c_company;
  UPDATE erp_nfe_recebidas SET estoque_status = 'pendente', lancado_pagar = false,
         concluida_em = NULL, concluida_por = NULL, updated_at = now()
   WHERE id = c_nota AND company_id = c_company;
END
$mig$;
