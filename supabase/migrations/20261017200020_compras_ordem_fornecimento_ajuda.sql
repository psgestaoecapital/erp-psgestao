-- #1677 etapa 4 (Gean) · Ordem de Fornecimento em PDF: textos do "?" (RD-95) dos campos de condições da OF e do botão
-- de download no pedido de compra (/dashboard/commerce/compras; o mesmo botão aparece em Pendências de compra e lê
-- estes textos pela rota do pedido). Só catálogo de ajuda: sem tabela, função, permissão ou dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Ordem de Fornecimento', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/commerce/compras', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('compras.of.data_prevista','Entrega prevista','A data combinada com o fornecedor para a mercadoria chegar.','Sai na Ordem de Fornecimento e orienta quem confere o recebimento.','24/10/2026.','Deixar em branco: a OF sai com "a combinar".',1),
 ('compras.of.frete_tipo','Frete','CIF quando o fornecedor paga o frete até a sua empresa; FOB quando a sua empresa paga ou retira.','Define na OF quem responde pelo transporte e pelo custo do frete.','CIF (por conta do fornecedor).','Marcar CIF e receber a nota com frete cobrado à parte.',2),
 ('compras.of.transportadora','Transportadora','O nome da transportadora combinada, quando houver.','Ajuda o recebimento a identificar a entrega.','Rodonaves.','Informar a transportadora no frete CIF sem confirmar com o fornecedor.',3),
 ('compras.of.condicao_pagamento','Condição de pagamento','Os prazos combinados com o fornecedor.','Sai na OF para a nota e o boleto virem no prazo certo.','28/56 dias.','Combinar um prazo e escrever outro: a nota vem com o vencimento errado.',4),
 ('compras.of.forma_pagamento','Forma de pagamento','Como a compra será paga.','Sai na OF e é usada quando o financeiro do pedido é gerado em Contas a pagar.','Boleto.','Trocar a forma depois de gerar o financeiro: os títulos não mudam sozinhos.',5),
 ('compras.of.observacoes','Observações para o fornecedor','Recados que o fornecedor precisa ler: horário de entrega, embalagem, contato no recebimento.','Saem na OF, antes do texto obrigatório da nota.','Entregar das 8h às 17h, falar com o almoxarifado.','Escrever aqui dado interno que o fornecedor não deve ver.',6),
 ('compras.of.salvar','Salvar condições','Toque para gravar a entrega, o frete e o pagamento deste pedido.','A OF em PDF usa o que estiver salvo.','—','Baixar a OF antes de salvar: ela sai com as condições antigas.',7),
 ('compras.of.baixar','Ordem de Fornecimento (PDF)','Toque para baixar a OF do pedido e enviar ao fornecedor.','Traz as duas empresas, os itens, os valores, a entrega, o frete, o pagamento e o número que o fornecedor deve escrever nas observações da nota. Quem confere o recebimento usa a mesma OF.','OF Nº PC-0012.','Mandar a compra sem a OF: a nota chega sem o número e fica difícil conferir.',8)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, status = EXCLUDED.status;
