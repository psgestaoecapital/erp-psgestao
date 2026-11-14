-- [#6723] Tryo (Angélica): "Excluir selecionados" na lista de orçamentos (/dashboard/orcamentos).
-- ADITIVA e IDEMPOTENTE: só adiciona as linhas de ajuda "?" (RD-95) dos dois novos controles
-- (caixa de seleção por linha/cabeçalho e ação "Excluir selecionados"). Nenhum dado de cliente é tocado.
-- A exclusão em lote reusa a RPC guardada já existente fn_orcamento_excluir (soft-delete rastreável, por empresa);
-- nenhuma função/permissão nova é criada aqui.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT * FROM (VALUES
  ('orcamentos.lista.selecionar', '/dashboard/orcamentos', 'Orçamentos', 'Selecionar orçamentos',
   'Marque a caixinha de cada orçamento que quer excluir, ou a caixinha do cabeçalho para marcar todos os que aparecem na lista.',
   'Permite excluir vários orçamentos de uma vez, por exemplo para limpar a lista de orçamentos antigos que não viraram negócio.',
   'Filtrar por "Recusado", marcar todos e clicar em Excluir selecionados.',
   'Esquecer que a seleção vale só para o que está visível com o filtro atual.',
   'hub', 970, 1, 'publicado'),
  ('orcamentos.lista.excluir_selecionados', '/dashboard/orcamentos', 'Orçamentos', 'Excluir selecionados',
   'Exclui os orçamentos marcados depois de você confirmar e informar o motivo. Eles saem da lista mas ficam no histórico (exclusão rastreável). Os que já viraram pedido ficam de fora e a tela mostra o motivo.',
   'Limpa a lista de orçamentos que não serviram sem mexer nos que já geraram negócio. Fica registrado quem excluiu, quando e por quê.',
   'Marcar 12 orçamentos recusados e clicar em Excluir selecionados.',
   'Achar que o orçamento sumiu do banco: a exclusão é lógica e continua no histórico.',
   'hub', 971, 1, 'publicado')
) AS t(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = t.chave);
