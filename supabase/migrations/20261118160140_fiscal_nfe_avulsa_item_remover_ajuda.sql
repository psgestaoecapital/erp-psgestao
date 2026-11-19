-- PDCA GE (auditor_pdca_2) · /dashboard/fiscal/nfe/remessa (Emitir NF-e avulsa)
-- RD-95: a ação "Remover item" da tabela de itens não tinha o "?" (AjudaCampo).
-- Aditiva e idempotente: cria a chave fiscal.nfe_avulsa.item_remover no padrão das 19 existentes.

INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES (
  'fiscal.nfe_avulsa.item_remover',
  '/dashboard/fiscal/nfe/remessa',
  'NF-e avulsa',
  'Remover item',
  'Toque na lixeira da linha para tirar o item da nota antes de emitir.',
  'Remove o produto da NF-e em edição. Só afeta esta nota; não mexe no cadastro do produto nem no estoque.',
  'Removeu o item errado? Busque o produto de novo e adicione.',
  'Remover todos os itens e tentar emitir: a SEFAZ rejeita nota sem itens.',
  'fiscal',
  18,
  'publicado'
)
ON CONFLICT (chave) DO NOTHING;
