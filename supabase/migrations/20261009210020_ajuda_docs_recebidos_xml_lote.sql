-- RD-95: "?" de Compras › Documentos Recebidos — o envio novo de XMLs em lote (GF4, caixa jordana-code d6441db4) e os
-- 3 campos antigos da tela que ainda não tinham "?" (ciência automática, busca e filtro de status), tocados nesta PR.
-- Aditivo: só INSERT de textos (ON CONFLICT DO NOTHING); nenhuma tabela, função ou permissão nova.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Documentos recebidos', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/compras/documentos-recebidos', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('compras.docs_recebidos.xml_lote', 'Subir XMLs em lote',
  'Escolha vários arquivos XML de NF-e de compra de uma vez, ou um .zip com eles (como o contador ou o fornecedor costuma mandar).',
  'Cada XML vira uma nota "Pronta" na lista, com itens e parcelas, para você conferir e lançar em Contas a Pagar sem digitar. Nada é lançado sozinho.',
  '30 XMLs de setembro num .zip → 28 notas prontas, 2 recusadas com o motivo de cada uma',
  'Mandar o PDF (DANFE) no lugar do XML, ou XML de nota destinada a outra empresa do grupo: esses são recusados e o painel mostra o motivo.', 10),
 ('compras.docs_recebidos.auto_ciencia', 'Dar ciência automática',
  'Marque para o sistema dar ciência na SEFAZ das notas novas emitidas para o CNPJ da empresa.',
  'Com a ciência dada, a SEFAZ libera o XML completo, e a nota fica pronta para lançar sem você pedir uma por uma.',
  'Marcado: a nota chega como resumo e em até 30 min já está com o XML',
  'Desmarcar e esquecer: as notas ficam paradas em "Resumo" sem o XML.', 11),
 ('compras.docs_recebidos.busca', 'Buscar nota',
  'Digite parte do nome do fornecedor, do CNPJ ou da chave de acesso.',
  'Filtra a lista para achar a nota que você quer conferir ou lançar.',
  'Black Prime, ou 12.345.678, ou os últimos números da chave',
  'Digitar o número da nota com zeros à esquerda que não estão na lista: busque pelo fornecedor.', 12),
 ('compras.docs_recebidos.filtro_status', 'Situação da nota',
  'Escolha a situação das notas que quer ver.',
  'Resumo = só o aviso da SEFAZ; Aguardando SEFAZ = XML a caminho; Pronta = pode lançar; Lançada = já está em Contas a Pagar; Ignorada = você descartou.',
  'Pronta, para lançar tudo o que já chegou',
  'Procurar uma nota já lançada com o filtro em Pronta: escolha Lançada ou Todos.', 13)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
