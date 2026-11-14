-- Gestão Empresarial · painel financeiro do dashboard (/dashboard/gestao-empresarial, DashboardRico › KpisDashboard) ·
-- RD-95: os 5 KPIs financeiros do topo do dashboard (A receber vencido, A receber hoje, A vencer este mês,
-- A pagar vencido, Saldo total) apareciam SEM o "?" (0 usos de AjudaCampo no componente KpisDashboard). Esta PR põe
-- o "?" em cada indicador; o texto vem do banco. Aqui ficam as 5 chaves novas (mesma rota do hub da GE).
--
-- ADITIVA (RD-94.1-c): só texto de ajuda novo em erp_ajuda_campo; não altera tabela/função nem toca dado de cliente.
-- Idempotente: ON CONFLICT (chave) DO NOTHING.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('ge.hub.kpi.receber_vencido', 'Painel financeiro', 'A receber vencido',
  'Nada a preencher: é a soma, em reais, dos títulos a receber que já venceram e ainda não foram recebidos.',
  'Mostra quanto a empresa já deveria ter recebido e não recebeu — o foco imediato da cobrança. Clique no cartão para abrir a lista desses títulos.',
  'Se há 3 boletos vencidos somando R$ 4.500,00, o indicador mostra R$ 4.500,00.',
  'Confundir com o total a receber: aqui entram SÓ os títulos já vencidos, não os que ainda vão vencer.', 1, '/dashboard/gestao-empresarial'),
 ('ge.hub.kpi.vencem_hoje', 'Painel financeiro', 'A receber hoje',
  'Nada a preencher: é a soma, em reais, dos títulos a receber que vencem na data de hoje.',
  'Mostra o que entra no caixa hoje, se for pago no prazo — ajuda a planejar o dia. Clique no cartão para ver a lista.',
  'Se dois clientes têm parcelas de R$ 800,00 e R$ 1.200,00 vencendo hoje, o indicador mostra R$ 2.000,00.',
  'Achar que "0" é erro: um dia sem vencimentos mostra R$ 0,00 — é o dado honesto, não falha.', 2, '/dashboard/gestao-empresarial'),
 ('ge.hub.kpi.vencer_mes', 'Painel financeiro', 'A vencer este mês',
  'Nada a preencher: é a soma, em reais, dos títulos a receber que ainda vão vencer dentro do mês atual.',
  'Mostra o que ainda está por entrar no mês — a previsão de recebimento. Clique no cartão para ver a lista.',
  'Se faltam vencer R$ 12.000,00 em parcelas até o fim do mês, o indicador mostra R$ 12.000,00.',
  'Contar o que já venceu: este número é só o que AINDA vai vencer; o vencido fica no cartão "A receber vencido".', 3, '/dashboard/gestao-empresarial'),
 ('ge.hub.kpi.pagar_vencido', 'Painel financeiro', 'A pagar vencido',
  'Nada a preencher: é a soma, em reais, dos títulos a pagar que já venceram e ainda não foram pagos.',
  'Mostra o que está em atraso com fornecedores e demais contas — prioridade para evitar juros e corte. Clique no cartão para ver a lista.',
  'Se há contas vencidas somando R$ 2.300,00, o indicador mostra R$ 2.300,00.',
  'Confundir com o total a pagar: aqui entram SÓ os títulos já vencidos, não os que ainda vão vencer.', 4, '/dashboard/gestao-empresarial'),
 ('ge.hub.kpi.saldo_total', 'Painel financeiro', 'Saldo total',
  'Nada a preencher: é a soma dos saldos atuais de todas as contas bancárias cadastradas da empresa.',
  'Mostra quanto a empresa tem disponível somando as contas — a base do caixa. Clique no cartão para abrir as contas bancárias.',
  'Se a empresa tem R$ 10.000,00 numa conta e R$ 5.000,00 em outra, o saldo total é R$ 15.000,00.',
  'Esperar que inclua o que há a receber/pagar: o saldo é só o dinheiro que já está nas contas, não a projeção do fluxo.', 5, '/dashboard/gestao-empresarial')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
