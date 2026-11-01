-- PDCA Hub (auditor_pdca_1) · /dashboard/hub/orcamento-itens · RD-95 ("?") dos controles novos.
--
-- Contexto (RD-38): a tela Itens do orçamento já tinha listagem + CRUD (fn_orcamento_item_*),
-- total e preço por contrato. Esta PR fecha gaps do auditor que ficam na camada de tela, sem
-- tocar núcleo: busca de itens, totalizador de quantidade (nº de itens + soma das quantidades) e
-- atalho "Novo orçamento". Aqui só cadastramos os 3 textos de ajuda das chaves novas.
--
-- 100% ADITIVA: só acrescenta linhas em erp_ajuda_campo (ON CONFLICT DO NOTHING).
-- Nenhuma tabela/coluna/função/RLS nova; nenhum dado de cliente alterado.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
  ('hub.orcamento_itens.busca', 'Itens do orçamento', 'Buscar item',
   'Digite parte da descrição ou da observação do item que procura.',
   'Filtra, na hora, a lista de itens do orçamento selecionado — útil quando o orçamento tem muitos itens. A busca é só sobre os itens já carregados desta tela; não altera nada no banco.',
   'Digitar "piso" mostra só os itens cuja descrição ou observação contém "piso".',
   'A busca não encontra itens de OUTRO orçamento: troque o orçamento no seletor do topo primeiro.',
   20, '/dashboard/hub/orcamento-itens', 'hub', 'publicado'),
  ('hub.orcamento_itens.qtd_itens', 'Itens do orçamento', 'Quantidade de itens',
   'Nada a preencher: é um indicador calculado.',
   'Mostra quantos itens aparecem na lista (respeitando a busca) e a soma das quantidades desses itens. Ajuda a conferir rapidamente o tamanho do orçamento sem contar linha por linha.',
   '12 itens · qtd 340 significa 12 linhas somando 340 unidades/m² no total.',
   'Com a busca ativa, o contador reflete só os itens filtrados — limpe a busca para ver o total do orçamento.',
   21, '/dashboard/hub/orcamento-itens', 'hub', 'publicado'),
  ('hub.orcamento_itens.novo_orcamento', 'Itens do orçamento', 'Novo orçamento',
   'Nada a preencher: é um atalho.',
   'Abre a tela de Orçamentos para criar um orçamento novo. Depois de criado, ele aparece no seletor do topo desta tela para você lançar os itens.',
   'Sem orçamento ainda nesta empresa? Toque em "Novo orçamento", crie o orçamento e volte para lançar os itens.',
   'Criar o orçamento em outra aba e não voltar: o seletor do topo só mostra o novo orçamento depois de recarregar a tela.',
   22, '/dashboard/hub/orcamento-itens', 'hub', 'publicado')
ON CONFLICT (chave) DO NOTHING;
