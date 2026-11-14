-- P&M · Tela Rentabilidade por cliente (/dashboard/pm/rentabilidade) — slice 2 da margem por cliente/serviço.
-- Consome SÓ a RPC fn_pm_indiretas_rateio (somente leitura, guarda fn_pm_pode_ver_margem): indiretas da GE rateadas
-- por cliente pela participação em receita/horas, com "despesas a classificar" à parte (RD-38, sem mascarar).
-- Esta migration é ADITIVA e IDEMPOTENTE: cadastra as chaves de ajuda RD-95 ("?" em filtro, KPIs e colunas) e
-- registra a tela em system_screens (RD-98 p3: rpcs_chamadas). NÃO toca dado de cliente, financeiro nem permissões.
-- Catálogo de ajuda é metadata de SISTEMA (sem dado de cliente).

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('pm.rentab.periodo','Rentabilidade por cliente','Período (De / Até)',
 'Escolha a data inicial e a final do intervalo que você quer analisar; o rateio considera os lançamentos por data de competência dentro desse período.',
 'Define quais despesas indiretas e qual base (receita ou horas) entram no cálculo do rateio por cliente.',
 'De 01/01/2026 até 31/10/2026 para ver o acumulado do ano até outubro.',
 'Escolher um período sem faturamento nem apontamento: a lista fica vazia porque não há base para ratear.',
 1,'/dashboard/pm/rentabilidade','pm','publicado'),
('pm.rentab.criterio','Rentabilidade por cliente','Critério de rateio',
 'Não se preenche aqui — é só informativo. Mostra como as indiretas estão sendo distribuídas: por receita ou por horas trabalhadas.',
 'Deixa claro e auditável a régua usada para dividir as despesas indiretas entre os clientes.',
 'Critério "Receita": um cliente que respondeu por 10% da receita recebe 10% das indiretas.',
 'Esperar que a conta mude aqui: o critério é configurado na régua de rateio da empresa, não nesta tela.',
 2,'/dashboard/pm/rentabilidade','pm','publicado'),
('pm.rentab.total_indiretas','Rentabilidade por cliente','Total das indiretas',
 'Valor automático. Soma das despesas indiretas da empresa no período (contas a pagar de tipo despesa, sem contrato vinculado).',
 'É o montante que será distribuído entre os clientes conforme a participação de cada um na base.',
 'R$ 989.530,38 em despesas indiretas de janeiro a outubro.',
 'Confundir com o faturamento: aqui são só as despesas indiretas a ratear, não a receita.',
 3,'/dashboard/pm/rentabilidade','pm','publicado'),
('pm.rentab.base_total','Rentabilidade por cliente','Base de rateio',
 'Valor automático. Soma da base usada para dividir as indiretas: a receita de todos os clientes (ou as horas), conforme o critério.',
 'É o denominador do rateio — a participação de cada cliente é a base dele dividida por esta base total.',
 'Base de receita de R$ 714.131,84 somando 135 clientes.',
 'Estranhar que a base seja menor que o faturamento total: só entra o que tem cliente identificado no período.',
 4,'/dashboard/pm/rentabilidade','pm','publicado'),
('pm.rentab.nao_classificado','Rentabilidade por cliente','Despesas a classificar',
 'Valor automático. Despesas indiretas sem conta no plano de contas; por isso não puderam ser rateadas e aparecem à parte.',
 'Mostra de forma honesta o que ficou de fora do rateio, para você classificar e não subestimar o custo por cliente.',
 'R$ 203.268,03 em 99 lançamentos ainda sem conta classificada.',
 'Ignorar este valor: enquanto não for classificado, o custo real por cliente está subestimado.',
 5,'/dashboard/pm/rentabilidade','pm','publicado'),
('pm.rentab.cliente','Rentabilidade por cliente','Cliente',
 'Não se preenche. Cada linha é um cliente com movimento (receita ou horas) no período escolhido.',
 'Identifica para quem as indiretas estão sendo rateadas.',
 'MARCOS ROBERTO BUENO, PROPLAY PRODUTORA LTDA…',
 'Dois registros com o mesmo nome: podem ser cadastros diferentes do mesmo cliente — confira o cadastro para unificar.',
 6,'/dashboard/pm/rentabilidade','pm','publicado'),
('pm.rentab.base','Rentabilidade por cliente','Receita / Horas (base)',
 'Valor automático. A base do cliente no período: a receita faturada dele (ou as horas apontadas), conforme o critério.',
 'Quanto maior a base do cliente, maior a fatia de indiretas que ele absorve.',
 'Cliente com R$ 51.250,00 de receita no período.',
 'Comparar receita com horas na mesma tela: a base segue um único critério por vez.',
 7,'/dashboard/pm/rentabilidade','pm','publicado'),
('pm.rentab.participacao','Rentabilidade por cliente','Participação',
 'Valor automático. O percentual que a base do cliente representa sobre a base total (a soma de todas as participações é 100%).',
 'É o peso do cliente no rateio das indiretas.',
 'Participação de 7,18% leva 7,18% das indiretas.',
 'Esperar que as participações não somem 100%: elas sempre fecham em 100% da base.',
 8,'/dashboard/pm/rentabilidade','pm','publicado'),
('pm.rentab.indiretas_rateadas','Rentabilidade por cliente','Indiretas rateadas',
 'Valor automático. A fatia das despesas indiretas atribuída ao cliente (total das indiretas × participação dele).',
 'É o custo indireto que deve ser descontado da receita do cliente para chegar à margem.',
 'R$ 71.014,13 de indiretas atribuídas ao cliente de maior receita.',
 'Somar esta coluna e não bater com o total: o resto de centavo do arredondamento vai para o cliente de maior base.',
 9,'/dashboard/pm/rentabilidade','pm','publicado')
ON CONFLICT (chave) DO NOTHING;

-- RD-98 p3: registrar a tela e a RPC consumida em system_screens (sem duplicar se já existir).
INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, views_consumidas, rpcs_chamadas, modulo, estado_real)
SELECT gen_random_uuid(), '/dashboard/pm/rentabilidade', 'pm', 'Rentabilidade por cliente',
       'Despesas indiretas da empresa (erp_pagar tipo=despesa sem contrato) rateadas por cliente pela participação em receita ou horas; mostra total das indiretas, base de rateio, despesas a classificar à parte e a fatia de cada cliente. Somente leitura (base da margem por cliente/serviço).',
       ARRAY[]::text[],
       ARRAY['fn_pm_indiretas_rateio','fn_ajuda_campo_listar']::text[],
       'pm', 'parcial'
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens WHERE rota = '/dashboard/pm/rentabilidade');
