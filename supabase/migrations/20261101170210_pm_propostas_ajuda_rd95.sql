-- AUDITORIA P&M (aud8, 31/10) · /dashboard/pm/propostas (nota 92) · RD-95 ("?") dos controles sem ajuda.
--
-- Contexto (RD-38): a tela já é funcional — KPIs com "?", CRUD completo e EXCLUSÃO RASTREÁVEL já existente
-- (fn_agency_proposta_excluir = soft-delete reversível, listagem filtra deleted_at) e origem do dado já
-- preenchida em system_screens. Faltava só "?" no botão principal (Nova proposta) e um "?" que explique a
-- lista/cartão de propostas (o que cada card mostra e as ações). Esta migration cadastra essas 2 chaves.
--
-- 100% ADITIVA: só acrescenta textos de ajuda em erp_ajuda_campo (ON CONFLICT DO NOTHING).
-- Nenhuma tabela/coluna/função/RLS; nenhum dado de cliente alterado.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
  ('pm.propostas.nova', 'Proposta', 'Nova proposta',
   'Nada a preencher: é a ação de criar uma proposta.',
   'Abre o formulário para criar uma proposta/orçamento desta empresa: cliente, título, itens (do catálogo de serviços ou avulsos), com totais calculados ao vivo. Ao aprovar, a proposta vira pedido de contrato.',
   'Comece pelo cliente e adicione os itens do catálogo; o total é somado automaticamente.',
   'Sem empresa selecionada no topo a tela não abre — escolha a empresa antes.',
   17, '/dashboard/pm/propostas', 'pm', 'publicado'),
  ('pm.propostas.lista', 'Proposta', 'Lista de propostas',
   'Nada a preencher: é a lista das propostas da empresa.',
   'Cada cartão mostra o título e o número da proposta, o cliente, o valor final, a condição de pagamento, a quantidade de itens e o status (rascunho, enviada, aprovada, recusada). As ações Editar e Excluir ficam no cartão; Excluir é reversível (soft-delete, nada é apagado de vez) e o histórico fica registrado.',
   'Uma proposta "aprovada" mostra o atalho para o pedido de contrato recorrente.',
   'Propostas excluídas não aparecem aqui — a exclusão é reversível pelo suporte, mas não há botão de "restaurar" nesta tela.',
   18, '/dashboard/pm/propostas', 'pm', 'publicado')
ON CONFLICT (chave) DO NOTHING;
