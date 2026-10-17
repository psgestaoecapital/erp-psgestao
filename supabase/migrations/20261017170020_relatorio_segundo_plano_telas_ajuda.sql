-- #3281 etapa 4 (Gean, vale para todas as empresas): botão "Gerar em segundo plano" nas telas pesadas.
-- Só o "?" (RD-95) do botão em cada tela; o pedido usa a fn_relatorio_pedir já publicada (#2743) e o gerador da rota
-- /api/relatorios/fila (#2756), que agora também monta Contas a pagar e Contas a receber em Excel. Aditiva.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Relatórios em segundo plano', 'Gerar em segundo plano', v.o_que, v.para_que, v.exemplo, v.erro, 90,
       v.rota, 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('relatorio.segundo_plano.pagar', '/dashboard/financeiro/pagar',
  'Escolha o período no filtro da tela e toque no botão. Nada mais a preencher.',
  'Gera o Excel das despesas com vencimento no período (resumo por mês, pago e em aberto) sem prender você na tela. Você recebe o aviso no sino e por e-mail e baixa em Financeiro > Meus relatórios.',
  'Período de 01/01 a 31/12 para conferir o ano inteiro.',
  'Esperar o arquivo na tela: pode fechar, ele continua sendo gerado. Os filtros de status, busca e categoria da tela não entram: o Excel traz todos os títulos do período.'),
 ('relatorio.segundo_plano.receber', '/dashboard/financeiro/receber',
  'Escolha o período no filtro da tela e toque no botão. Nada mais a preencher.',
  'Gera o Excel das receitas com vencimento no período (resumo por mês, recebido e em aberto) sem prender você na tela. Você recebe o aviso no sino e por e-mail e baixa em Financeiro > Meus relatórios.',
  'Últimos 12 meses para ver a inadimplência mês a mês.',
  'Esperar o arquivo na tela: pode fechar, ele continua sendo gerado. Os filtros de status, busca e categoria da tela não entram: o Excel traz todos os títulos do período.'),
 ('relatorio.segundo_plano.extrato', '/dashboard/financeiro/extrato',
  'Escolha as datas no filtro da tela e toque no botão. Nada mais a preencher.',
  'Gera o Excel da Movimentação financeira do período (cada pagamento e recebimento, de todas as contas, com resumo por mês) sem prender você na tela. Baixe em Financeiro > Meus relatórios.',
  'Últimos 12 meses, para mandar ao contador.',
  'Achar que vem só a conta escolhida: o Excel traz todas as contas da empresa.')
) AS v(chave, rota, o_que, para_que, exemplo, erro)
ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, status = EXCLUDED.status;
