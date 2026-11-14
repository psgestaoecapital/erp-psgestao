-- #3865 (FC Pisos / todas as empresas): requisição/baixa de EPI pela tela de Estoque.
-- Ajuda RD-95 ("?") dos dois novos controles da tela /dashboard/compliance/epi/estoque:
--   - seletor de funcionário para a entrega/baixa;
--   - botão "Entregar EPI" (abre o fluxo de entrega, que dá baixa no estoque via fn_epi_registrar_entrega).
-- Aditiva e idempotente (ON CONFLICT (chave) DO NOTHING). Não altera dado de cliente.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('compliance.epi.estoque.entrega_funcionario','/dashboard/compliance/epi/estoque','Controles','Entregar EPI a um funcionário (dar baixa)','O funcionário ativo da empresa que vai receber o EPI. A lista mostra nome, CPF e setor.','Faz a requisição/baixa do EPI: a entrega sai do saldo disponível do estoque e fica registrada na ficha do funcionário (NR-6), com data, operador e assinatura.','Maria Silva · 123.456.789-00 — Produção','Escolher a empresa-alvo errada no topo: a lista de funcionários é a da empresa selecionada para o estoque.','compliance',13,'publicado'),
 ('compliance.epi.estoque.nav_entrega_func','/dashboard/compliance/epi/estoque','Controles','Entregar EPI','Depois de escolher o funcionário, abre o passo a passo da entrega para selecionar o EPI, a quantidade, informar o motivo e coletar a assinatura.','Conclui a baixa: o EPI sai do estoque disponível e a entrega vira movimento com data, operador, motivo e assinatura do funcionário (NR-6). EPIs não são faturados — este é o controle de entrega e baixa.','—','Clicar sem escolher o funcionário (o botão fica indisponível até selecionar).','compliance',14,'publicado')
ON CONFLICT (chave) DO NOTHING;
