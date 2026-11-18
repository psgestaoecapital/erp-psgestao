-- Chamado #6728 · NF-e avulsa: salvar como rascunho e perguntar ao sair sem emitir · Code: rodrigo-code
-- ETAPA 2 (UI) — ajuda dos dois controles novos da tela "Emitir NF-e avulsa" (/dashboard/fiscal/nfe/remessa):
--   "Salvar rascunho" e a lista "Rascunhos". RD-95: todo controle novo tem o "?" com a chave no banco.
-- ADITIVA e IDEMPOTENTE: só acrescenta 2 linhas de ajuda (ON CONFLICT atualiza o texto). Não toca schema,
-- dado de cliente, RLS, permissões nem emissão fiscal. Backend do rascunho: 20261115102130_nfe_avulsa_rascunho.sql.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('fiscal.nfe_avulsa.salvar_rascunho','/dashboard/fiscal/nfe/remessa','NF-e avulsa','Salvar rascunho',
   'Clique para guardar tudo o que já digitou (destinatário, operação, itens, frete e informações complementares) sem emitir a nota. O rascunho fica salvo só para você, nesta empresa.',
   'Serve para parar no meio — por exemplo, corrigir o cadastro de um produto — e voltar depois sem redigitar a nota inteira. O rascunho NÃO gera título no financeiro, NÃO movimenta o estoque e NÃO consome numeração fiscal. Quando a nota é emitida, o rascunho é removido automaticamente.',
   'Faltou o cadastro de um item: salve o rascunho, cadastre o produto e volte pela lista "Rascunhos" para continuar e emitir.',
   'Salvar rascunho não emite a nota. Para enviar à SEFAZ, use o botão "Emitir NF-e" depois de completar os dados.',
   'fiscal', 19, 1, 'publicado'),
  ('fiscal.nfe_avulsa.rascunhos','/dashboard/fiscal/nfe/remessa','NF-e avulsa','Rascunhos',
   'Lista dos rascunhos que você salvou nesta empresa. Clique em "Abrir" para carregar o rascunho no formulário e continuar de onde parou; "Excluir" apaga o rascunho.',
   'É por onde você retoma uma nota começada antes. Ao abrir, todos os campos são repreenchidos com o que estava salvo. Só aparecem os seus próprios rascunhos, da empresa selecionada.',
   'Você salvou a nota ontem; hoje abre a tela, clica em "Abrir" no rascunho e emite.',
   'Não vejo meu rascunho? Confira se a empresa selecionada no topo é a mesma em que você salvou — o rascunho pertence à empresa e a você.',
   'fiscal', 20, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo,
  o_que_preencher=EXCLUDED.o_que_preencher, para_que_serve=EXCLUDED.para_que_serve,
  exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();
