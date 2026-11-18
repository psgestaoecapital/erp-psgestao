-- #6874 (máscara R$ · CampoMoeda) — RD-95: "?" do campo "Valor mensal (R$)" do contrato (formulários Novo e Editar).
-- Aditivo e idempotente: 2 linhas de ajuda de catálogo global (public.erp_ajuda_campo, UNIQUE(chave)).
-- Não é tabela de dado de cliente/financeiro/fiscal; sem RLS/grant novo, sem UPDATE/DELETE, sem ALTER.
-- Lido por fn_ajuda_campo_listar('/dashboard/contratos') → surge no "?" (AjudaCampo infere a rota pelo pathname).
-- Prova RD-38 (produção, BEGIN…ROLLBACK): antes = 0, após INSERT = 2, repetição idempotente = 2 (nada persistido).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('ge.contrato.novo.valor_mensal', '/dashboard/contratos', 'Contratos', 'Valor mensal (R$)',
   'Valor em reais que o cliente paga por mês neste contrato. Digite só os números — o campo formata em R$ sozinho (use vírgula para os centavos).',
   'É a base do MRR e das contas a receber geradas quando o contrato é ativado; o reajuste aplica o percentual sobre este valor.',
   '2.500,00',
   'Digitar com ponto no lugar da vírgula ou sem os centavos. Para dois mil e quinhentos reais, digite 2.500,00 (não 2500.00 nem 250000).',
   'gestao_empresarial', 3),
  ('ge.contrato.editar.valor_mensal', '/dashboard/contratos', 'Editar contrato', 'Valor mensal (R$)',
   'Novo valor mensal em reais do contrato. Digite só os números — o campo formata em R$ sozinho (use vírgula para os centavos).',
   'Atualiza o valor atual do contrato e, com ele, o MRR. Não mexe nas contas a receber já geradas; vale daqui para a frente.',
   '2.800,00',
   'Trocar o valor achando que corrige parcelas já lançadas: aqui muda o valor do contrato para a frente, não as cobranças antigas.',
   'gestao_empresarial', 3)
ON CONFLICT (chave) DO NOTHING;
