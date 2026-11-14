-- /dashboard/operacional (núcleo: consulta unificada Receber/Pagar/Clientes/Fornecedores/Bancárias/Plano)
-- RD-95: "?" nas 6 abas e nos 5 KPIs. RD-98 p3: preencher origem do dado (system_screens).
-- Aditivo/idempotente. erp_ajuda_campo: ON CONFLICT (chave) DO NOTHING.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('operacional.aba_receber','/dashboard/operacional','Operacional','Contas a Receber','Mostra os títulos que a empresa tem a receber (vendas, serviços, recebimentos previstos).','Acompanha entradas, vencimentos e atrasos; os KPIs e o total somam só esta aba.','—','Lançar aqui uma conta a pagar — use a aba Contas a Pagar.','gestao_empresarial',10,'publicado'),
 ('operacional.aba_pagar','/dashboard/operacional','Operacional','Contas a Pagar','Mostra os títulos que a empresa tem a pagar (fornecedores, despesas, compromissos).','Acompanha saídas, vencimentos e atrasos; os KPIs e o total somam só esta aba.','—','Lançar aqui um recebimento — use a aba Contas a Receber.','gestao_empresarial',20,'publicado'),
 ('operacional.aba_clientes','/dashboard/operacional','Operacional','Clientes','Cadastro dos clientes da empresa (nome, documento, contato, cidade).','Permite vincular o cliente aos recebimentos e reaproveitar os dados nos lançamentos.','—','—','gestao_empresarial',30,'publicado'),
 ('operacional.aba_fornecedores','/dashboard/operacional','Operacional','Fornecedores','Cadastro dos fornecedores da empresa.','Permite vincular o fornecedor às contas a pagar e reaproveitar os dados.','—','—','gestao_empresarial',40,'publicado'),
 ('operacional.aba_bancarias','/dashboard/operacional','Operacional','Contas Bancárias','As contas bancárias da empresa (banco, agência, conta, saldo inicial).','Usadas para indicar por onde o título foi pago/recebido e conciliar o caixa.','Conta Corrente · Banco X','—','gestao_empresarial',50,'publicado'),
 ('operacional.aba_plano','/dashboard/operacional','Operacional','Plano de Contas','As categorias contábeis (receitas, custos, despesas) usadas para classificar os lançamentos.','Classificar cada título por categoria alimenta o DRE e os relatórios por tipo.','3.1.01 Receita de vendas','Deixar lançamentos sem categoria — eles ficam de fora das análises por tipo.','gestao_empresarial',60,'publicado'),
 ('operacional.kpi_total','/dashboard/operacional','Operacional','Total','Soma do valor de todos os lançamentos filtrados na aba atual.','Mostra o volume total a receber (ou a pagar) conforme os filtros aplicados.','R$ 25.000,00','Comparar o Total entre abas diferentes — cada aba soma o seu próprio tipo.','gestao_empresarial',70,'publicado'),
 ('operacional.kpi_liquidado','/dashboard/operacional','Operacional','Recebido / Pago','Soma dos títulos já liquidados (status Recebido na aba Receber, ou Pago na aba Pagar).','Mostra quanto do total já entrou (ou já saiu) do caixa.','R$ 10.000,00','—','gestao_empresarial',80,'publicado'),
 ('operacional.kpi_pendente','/dashboard/operacional','Operacional','Pendente','Soma dos títulos com status "A Vencer" (ainda dentro do prazo).','Mostra o que está programado e ainda não venceu.','R$ 8.000,00','—','gestao_empresarial',90,'publicado'),
 ('operacional.kpi_vencido','/dashboard/operacional','Operacional','Vencido','Soma dos títulos com status "Vencido" (passaram do vencimento sem baixa).','Destaca o que precisa de cobrança (ou de pagamento) imediato.','R$ 2.000,00','Confundir "Vencido" com "Pendente" — vencido já passou do prazo.','gestao_empresarial',100,'publicado'),
 ('operacional.kpi_registros','/dashboard/operacional','Operacional','Registros','Quantidade de lançamentos que atendem aos filtros atuais da aba.','Confere quantos títulos a lista está mostrando.','42','—','gestao_empresarial',110,'publicado')
ON CONFLICT (chave) DO NOTHING;

-- RD-98 p3: origem do dado (só preenche se estiver NULL, não sobrescreve ajuste manual)
UPDATE public.system_screens
SET views_consumidas = ARRAY['erp_lancamentos','erp_clientes','erp_fornecedores','erp_plano_contas','erp_contas_bancarias'],
    rpcs_chamadas    = ARRAY['fn_lancamento_excluir']
WHERE rota = '/dashboard/operacional'
  AND (views_consumidas IS NULL OR rpcs_chamadas IS NULL);
