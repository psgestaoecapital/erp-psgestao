-- RD-95 · "?" da prévia das Informações Complementares da NF-e no card do pedido (OTC) — pedido Jordana 20/10 (FCR).
-- Só dado de ajuda (tabela global erp_ajuda_campo); idempotente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'NF-e do pedido', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/commerce/otc', 'comercio', 'publicado'
FROM (VALUES
 ('otc.nfe.informacoes_complementares', 'Informações complementares da nota',
  'O texto que vai impresso na nota, no quadro "Informações complementares". Ele já vem montado: primeiro as Observações do pedido (as do orçamento), depois os textos obrigatórios do Simples e o valor aproximado dos tributos (Lei 12.741), quando a empresa usa. Pode editar antes de emitir.',
  'É onde o cliente encontra dados como o número da ordem de compra dele. O que estiver aqui na hora de emitir é exatamente o que sai na nota. As observações internas do pedido nunca entram.',
  'Ordem de compra nº 123 | DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL...',
  'Apagar o texto do Simples ou dos tributos sem combinar com o contador. Passar de 5.000 caracteres: a nota não sai até encurtar.', 1),
 ('otc.nfe.informacoes_complementares_restaurar', 'Voltar ao texto automático',
  'Toque para desfazer a sua edição e voltar ao texto montado pelo sistema.',
  'Útil quando apagou algo sem querer, como o texto obrigatório do Simples.',
  '—', 'Tocar depois de digitar uma informação que você queria manter: ela some.', 2),
 ('otc.nfe.informacoes_complementares_tentar', 'Tentar de novo',
  'Toque para montar de novo o texto das informações complementares.',
  'Se o texto não carregou, a nota ainda sai com o texto automático; tentar de novo permite conferir e editar antes de emitir.',
  '—', 'Emitir sem conferir quando o pedido tem uma informação importante nas Observações.', 3)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, status = EXCLUDED.status;

-- Mesmo texto na NF-e de peças da OS (Oficina): Observações para o cliente da OS + textos legais (item 5 do pedido).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Oficina', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/os', 'oficina', 'publicado'
FROM (VALUES
 ('oficina.os.nfe_informacoes_complementares', 'Informações complementares da nota',
  'O texto que vai impresso na NF-e das peças, no quadro "Informações complementares". Ele já vem montado: primeiro as Observações para o cliente da OS, depois os textos obrigatórios do Simples e o valor aproximado dos tributos (Lei 12.741), quando a empresa usa. Pode editar antes de emitir.',
  'É onde o cliente encontra dados como o número do pedido de compra dele ou a placa do veículo. O que estiver aqui na hora de emitir é exatamente o que sai na nota. As observações internas da OS nunca entram.',
  'Pedido de compra nº 123 | DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL...',
  'Apagar o texto do Simples ou dos tributos sem combinar com o contador. Passar de 5.000 caracteres: a nota não sai até encurtar.', 60),
 ('oficina.os.nfe_informacoes_complementares_restaurar', 'Voltar ao texto automático',
  'Toque para desfazer a sua edição e voltar ao texto montado pelo sistema.',
  'Útil quando apagou algo sem querer, como o texto obrigatório do Simples.',
  '—', 'Tocar depois de digitar uma informação que você queria manter: ela some.', 61)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, status = EXCLUDED.status;
