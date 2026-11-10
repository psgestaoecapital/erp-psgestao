-- #7641 · Revenda › Vendas e entrega: status da NF-e no card da venda, DANFE/XML (ajuda "?", RD-95). Aditiva e idempotente.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES ('revenda.vendas.nfe_status', '/dashboard/revenda/vendas', 'Venda e entrega', 'Nota fiscal da venda',
  'Nada a preencher: o card mostra a situação real da NF-e desta venda e atualiza sozinho enquanto ela é enviada à SEFAZ.',
  'Mostra se a nota está sendo enviada, autorizada (com o número) ou rejeitada (com o motivo em português). Autorizada: use Imprimir DANFE e Baixar XML, ou abra a tela NFes Emitidas para carta de correção e cancelamento.',
  'Autorizada nº 506: Imprimir DANFE abre o PDF da nota e Baixar XML entrega o arquivo.',
  'Nota rejeitada por dado faltando (ex.: CEP do cliente): corrija o cadastro e clique em Emitir NF-e para reenviar.',
  'revenda_veiculos', 'publicado')
ON CONFLICT DO NOTHING;
