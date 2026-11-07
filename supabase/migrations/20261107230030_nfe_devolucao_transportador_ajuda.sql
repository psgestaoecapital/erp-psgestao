-- #5722 (Vianz) · Devolução de compra: bloco "Transportador" (nome, CNPJ/CPF, IE, UF, placa) — RD-95.
-- Aditiva e idempotente (ON CONFLICT DO NOTHING); só catálogo de ajuda, não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/fiscal/nfe/devolucao', 'fiscal', 'publicado'
FROM (VALUES
 ('fiscal.nfe.devolucao.transportador', 'Devolução de compra', 'Transportador',
  'Quem leva a mercadoria de volta ao fornecedor: nome, CNPJ ou CPF, inscrição estadual, UF e a placa do veículo (quando houver). Aparece quando a modalidade do frete não é "sem frete".',
  'Vai no grupo de transporte da NF-e de devolução. A modalidade (CIF/FOB) diz quem paga o frete; o transportador diz quem faz o transporte.',
  'Transportadora Rápida Ltda, CNPJ 12.345.678/0001-90, UF SP, placa ABC1D23.',
  'Escolher CIF/FOB e deixar o transportador em branco, ou trocar CNPJ por CPF. Com frete "sem frete" (9) este bloco some.',
  60)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
