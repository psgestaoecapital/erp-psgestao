-- NF-e de devolução de compra · "?" (RD-95) dos botões "Baixar DANFE (PDF)" e "Baixar XML" que aparecem na própria tela
-- /dashboard/fiscal/nfe/devolucao logo depois da emissão — jordana-code (faixa 20), chamado #4050 (Gean).
-- ADITIVA: só insere uma linha nova em erp_ajuda_campo (ON CONFLICT DO NOTHING); nada existente é alterado.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/fiscal/nfe/devolucao', 'fiscal', 'publicado'
FROM (VALUES
  ('fiscal.nfe.devolucao.baixar', 'Devolução de compra', 'Baixar DANFE / XML',
   'Não se preenche: depois que a SEFAZ autoriza a devolução, clique em "Baixar DANFE (PDF)" ou "Baixar XML" para salvar a nota no computador.',
   'Entrega o arquivo da nota de devolução na hora, para enviar ao fornecedor junto com a mercadoria, sem procurar a nota em NF-e emitidas.',
   'Devolução nº 650 autorizada → "Baixar DANFE (PDF)" salva o arquivo com o nome do fornecedor, o número da nota e a data.',
   'Se aparecer o aviso de que o arquivo ainda está sendo gerado, espere alguns segundos e clique de novo; a nota também fica em Fiscal › NF-e emitidas.',
   30)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
