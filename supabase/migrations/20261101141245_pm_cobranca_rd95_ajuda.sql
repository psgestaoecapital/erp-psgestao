-- RD-95 (CEO 08/10): "?" na tela Cobrança / Fee (P&M · Financeiro) · /dashboard/pm/cobranca.
-- O auditor PDCA pediu fechar RD-95; a tela não tinha nenhum "?". Esta PR cadastra a ajuda do contexto
-- da tela, dos 2 indicadores (Contratos a cobrar / MRR) e do indicador de status da cobrança por contrato.
-- Sem mexer no cálculo/fluxo nem na emissão na GE (erp_receber/Asaas). Aditivo: só texto em erp_ajuda_campo.
-- Idempotente (ON CONFLICT chave).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/pm/cobranca', 'pm', 'publicado'
FROM (VALUES
 ('pm.cobranca.tela', 'Cobrança · Visão geral', 'Cobrança / Fee',
  'Lista das mensalidades recorrentes (contratos de fee ativos) a cobrar no mês. Não se digita aqui: os valores vêm dos contratos.',
  'Mostra o que a agência tem a receber de fee no mês e serve de base para emitir as cobranças na Gestão Empresarial.',
  'Três clientes com fee ativo aparecem com o valor e o dia de vencimento do mês corrente.',
  'Esperar cadastrar fee aqui: a mensalidade vem do contrato do cliente — esta tela só acompanha e cobra.',
  1),
 ('pm.cobranca.kpi_contratos', 'Cobrança · Indicadores', 'Contratos a cobrar',
  'Quantidade de contratos de fee recorrente ativos a cobrar no mês. É um indicador, não se edita.',
  'Dá o tamanho da carteira recorrente do mês — quantas cobranças sairão.',
  '3 contratos a cobrar = três fees ativos no período.',
  'Achar que inclui jobs avulsos: conta só os contratos recorrentes ativos.',
  2),
 ('pm.cobranca.kpi_mrr', 'Cobrança · Indicadores', 'Total do mês (MRR)',
  'Soma dos fees mensais dos contratos recorrentes ativos (receita recorrente mensal). Indicador, não se edita.',
  'Mostra a receita recorrente prevista do mês — base do faturamento previsível da agência.',
  'R$ 15.000 de MRR = soma dos fees dos contratos ativos.',
  'Confundir MRR com o que já foi recebido: é o previsto do mês, não o caixa realizado.',
  3),
 ('pm.cobranca.indicador_cobranca', 'Cobrança · Status', 'Status da cobrança',
  'Mostra se a cobrança do contrato já foi emitida na Gestão Empresarial (✓) ou ainda será emitida.',
  'Evita cobrar duas vezes: indica por contrato o que já virou cobrança na GE (erp_receber/Asaas).',
  '"→ cobrança emitida ✓" = a cobrança desse cliente já foi gerada no mês.',
  'Emitir de novo um contrato já com ✓: geraria cobrança duplicada para o cliente.',
  4)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;
