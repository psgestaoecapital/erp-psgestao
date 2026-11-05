-- Produtividade · Produtos: 3ª via de cadastro — "Importar do sistema vinculado" (pedido do CEO 04/11, Frioeste).
-- "?" (RD-95) dos 3 controles novos do modal de importação. RD-100: rótulos sempre "sistema vinculado"/"fonte
-- vinculada", nunca o nome do fornecedor do conector. Aditiva (só texto de ajuda novo; sem dado de cliente).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'industria', 'publicado'
FROM (VALUES
 ('prod.produto.importar_vinculado', 'Produtos', 'Importar do sistema vinculado',
  'Abra a lista dos produtos que já vêm do sistema vinculado, marque os que quer trazer e confirme.',
  'Traz os produtos direto da fonte vinculada, sem digitar um a um nem colar lista; o que já existe fica marcado como "já importado" e não duplica.',
  'Marcar 20 cortes da fonte vinculada e confirmar: os 20 entram na lista de produtos com código e nome preenchidos.',
  'Esperar que ele altere produtos que já existem: só cria os que ainda não estão na lista; os demais aparecem como "já importado".',
  20, '/dashboard/produtividade/produtos'),
 ('prod.produto.importar_fonte', 'Produtos', 'Fonte vinculada',
  'Escolha de qual fonte vinculada listar os produtos (quando houver mais de uma).',
  'Separa os produtos por origem quando a empresa tem mais de um sistema vinculado conectado.',
  'Uma empresa com duas fontes vinculadas: escolha a fonte para ver só os produtos dela.',
  'Importar da fonte errada quando há mais de uma: confira a fonte selecionada no topo antes de confirmar.',
  21, '/dashboard/produtividade/produtos'),
 ('prod.produto.importar_busca', 'Produtos', 'Buscar na lista do sistema vinculado',
  'Digite parte do nome do produto para filtrar a lista que veio da fonte vinculada.',
  'Ajuda a achar rápido os produtos a importar quando a fonte traz muitos itens.',
  'Digitar "dianteiro" para ver só os produtos com esse nome.',
  'Achar que a busca grava algo: ela só filtra a lista; a importação é no botão confirmar.',
  22, '/dashboard/produtividade/produtos')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
