-- #135 (Triches) · etapa 2: incluir/editar itens, quantidade e preço direto na ficha da Ordem de Serviço.
-- ADITIVA: só os textos do "?" (RD-95) dos campos novos. Sem tabela, função ou dado de cliente
-- (a ficha grava pela RPC já existente fn_oficina_diagnostico_salvar, a mesma da tela de Diagnóstico).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Oficina', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/os', 'oficina', 'publicado'
FROM (VALUES
  ('oficina.os.editar_itens', 'Editar itens e preços',
   'Clique para incluir peças e serviços na OS e lançar quantidade e preço, sem sair da Ordem de Serviço. Aparece só no atendimento centralizado (sem tablet), para quem pode lançar valor, com a OS em "Recebido" ou "Aguardando aprovação".',
   'Monta o orçamento na própria OS: os itens gravados aqui são os mesmos da tela de Diagnóstico e entram no total, no PDF e na aprovação do cliente.',
   'Cliente trouxe o caminhão com barulho no câmbio → "+ Serviço" Revisão do câmbio, 1, R$ 450,00 · "+ Peça" Óleo 75W90, 4, R$ 68,00 → Salvar itens.',
   'Itens já aprovados ou recusados pelo cliente não mudam aqui. Para remover um item, use a tela de Diagnóstico.', 2),
  ('oficina.os.item_descricao', 'Descrição do item',
   'O nome da peça ou do serviço como o cliente vai ler no orçamento.',
   'Aparece no orçamento, no PDF e na nota. Peça digitada pode ser ligada ao estoque depois, no botão "estoque" da lista de itens.',
   'Filtro de óleo do motor · Troca de embreagem.',
   'Deixar a descrição em branco: a linha vazia é ignorada ao salvar.', 3),
  ('oficina.os.item_quantidade', 'Quantidade',
   'Quantas unidades (peça) ou quantas vezes (serviço). Aceita vírgula: 1,5.',
   'O valor do item é quantidade × preço unitário.',
   '4 litros de óleo → quantidade 4.',
   'Quantidade zero ou em branco: o sistema pede para corrigir (em branco vale 1).', 4),
  ('oficina.os.item_preco', 'Preço unitário',
   'O preço de UMA unidade, em reais. Aceita vírgula: 68,50.',
   'Multiplica pela quantidade para dar o valor do item e o total da OS.',
   'Óleo a R$ 68,00 o litro, 4 litros → preço 68,00 (o item fica R$ 272,00).',
   'Digitar o total do item em vez do preço de uma unidade: o valor sai multiplicado pela quantidade.', 5)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
