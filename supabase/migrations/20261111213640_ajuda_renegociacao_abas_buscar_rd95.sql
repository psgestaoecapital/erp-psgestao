-- RD-95: completar o "?" (AjudaCampo) da tela Renegociacao / Acerto.
-- aud8 10/11 (92/95): os campos Cliente/Conta ja tinham "?", mas faltava nas abas
-- "Criar acerto" / "Consultar" e no botao "Buscar titulos abertos".
-- Aditiva e idempotente: insere 3 chaves novas em erp_ajuda_campo (ON CONFLICT DO NOTHING).

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, vertical, ordem, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('financeiro.renegociacao.aba_criar',
   '/dashboard/financeiro/renegociacao', 'Renegociação / Acerto', 'Aba Criar acerto', 'financeiro', 1,
   'Use esta aba para montar um novo acerto: buscar os títulos abertos do cliente, juntar em um só e gerar as parcelas novas.',
   'É por aqui que você renegocia dívidas: os títulos selecionados viram "renegociado" e no lugar entram as parcelas combinadas.',
   'Criar acerto de 3 duplicatas vencidas em 4 parcelas novas.',
   'Tentar criar o acerto sem antes buscar e marcar os títulos de origem.'),
  ('financeiro.renegociacao.aba_consultar',
   '/dashboard/financeiro/renegociacao', 'Renegociação / Acerto', 'Aba Consultar', 'financeiro', 2,
   'Abra esta aba para ver os acertos já feitos, abrir o detalhe de cada um e, se precisar, cancelar.',
   'Mostra o histórico de renegociações da empresa com os títulos de origem e as parcelas geradas.',
   'Consultar o acerto criado ontem e conferir as parcelas.',
   'Cancelar um acerto já pago imaginando que é só um rascunho: confira o status antes.'),
  ('financeiro.renegociacao.buscar',
   '/dashboard/financeiro/renegociacao', 'Renegociação / Acerto', 'Buscar títulos abertos', 'financeiro', 25,
   'Clique para listar os títulos em aberto ou vencidos do cliente/conta escolhidos acima.',
   'Traz os títulos que podem entrar no acerto; sem buscar não há o que renegociar.',
   'Filtrar por "Casa Verde Ltda" e buscar para ver as duplicatas em aberto.',
   'Buscar sem escolher cliente e selecionar títulos de clientes diferentes: o acerto é de um cliente só.')
ON CONFLICT (chave) DO NOTHING;
