-- RD-95 ("?" em todo campo/filtro/indicador/ação) · Análises (Gestão Empresarial) — cobertura restante.
-- Gap do auditor aud8 (/dashboard/analises): "RD-95: cobertura insuficiente — múltiplos indicadores e
-- painéis sem '?'". A migration 20261110140540 cadastrou filtros/abas/KPIs principais; a #5221 cobriu os
-- gráficos. Esta migration fecha os INDICADORES restantes do Painel Geral (Empréstimos Recebidos, Empresas)
-- e os PAINÉIS de drill-down (Linhas de Receita e Resultado Financeiro). O page.tsx passa a referenciar
-- cada chave com <AjudaCampo chave="..." /> / prop `ajuda`.
-- Catálogo de ajuda é metadata de SISTEMA (sem dado de cliente).
-- ADITIVO/IDEMPOTENTE: ON CONFLICT (chave) DO NOTHING.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('analises.kpi_emprestimos','Indicadores','Empréstimos Recebidos',
 'Indicador: soma das entradas NÃO operacionais no período — empréstimos, financiamentos e aportes de sócios que entraram no caixa.',
 'Separa o dinheiro que entrou por captação do que entrou por venda: ajuda a não confundir fôlego de caixa com resultado da operação.',
 'R$ 50.000 de empréstimo bancário no mês — entra no caixa, mas não é receita da operação.',
 'Somar o empréstimo à receita e achar que a empresa faturou mais — ele é dívida a pagar, não resultado.',
 11,'/dashboard/analises','gestao_empresarial','publicado'),
('analises.kpi_empresas','Indicadores','Empresas',
 'Indicador: quantidade de CNPJs (empresas) incluídos na visão atual — reflete o filtro de empresa/grupo no topo da tela.',
 'Mostra se os números são de uma empresa só ou de um consolidado; é a base para ler os demais indicadores no contexto certo.',
 '3 empresas consolidadas quando o filtro está em "Todas" ou num grupo com três CNPJs.',
 'Comparar o resultado achando que é de uma empresa quando o indicador aponta várias — confira o seletor de empresa.',
 12,'/dashboard/analises','gestao_empresarial','publicado'),
('analises.linhas_receita','Painéis','Linhas de Receita',
 'Painel de detalhe: lista as principais linhas de receita operacional do período; clique numa linha para abrir os lançamentos que a compõem.',
 'Mostra DE ONDE vem o faturamento (clientes, produtos, serviços), do maior para o menor, para entender a concentração da receita.',
 'Ver que 60% da receita do mês vem de duas linhas e avaliar o risco dessa concentração.',
 'Ler só o topo e ignorar a cauda de linhas menores que, somadas, pesam no faturamento.',
 13,'/dashboard/analises','gestao_empresarial','publicado'),
('analises.resultado_financeiro','Painéis','Resultado Financeiro',
 'Painel de detalhe (DRE mensal): receitas, custos, despesas e resultado mês a mês; clique nas linhas para abrir o detalhe de cada grupo.',
 'Permite acompanhar a evolução do resultado ao longo dos meses e descer até os lançamentos que formam cada valor.',
 'Abrir a linha "Despesas Administrativas" de março para ver quais contas puxaram o custo para cima.',
 'Analisar um único mês isolado sem olhar a tendência dos meses anteriores que o painel mostra lado a lado.',
 14,'/dashboard/analises','gestao_empresarial','publicado')
ON CONFLICT (chave) DO NOTHING;
