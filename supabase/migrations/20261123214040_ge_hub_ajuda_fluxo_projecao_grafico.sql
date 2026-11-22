-- GE hub (/dashboard/gestao-empresarial) — gap PDCA aud8 88/95:
-- novo gráfico de evolução do caixa (GraficoFluxoProjetado) precisa da chave de ajuda
-- RD-95 ("?"). Aditiva e idempotente: só INSERT da chave nova; não altera dado existente.
INSERT INTO public.erp_ajuda_campo
  (rota, chave, vertical, grupo, ordem, rotulo, status, versao,
   o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES (
  '/dashboard/gestao-empresarial',
  'ge.hub.fluxo_projecao_grafico',
  'gestao_empresarial',
  'Visão geral',
  2,
  'Evolução do caixa',
  'publicado',
  1,
  'Nada a preencher: o gráfico lê sozinho os lançamentos a pagar e a receber e os saldos das contas da empresa.',
  'Mostra como o saldo em caixa evolui dia a dia na projeção dos próximos 30 dias (ou o realizado, quando não há pendências futuras), para você antecipar quando o dinheiro pode faltar.',
  'Se o saldo começa em R$ 20.000, há R$ 8.000 a receber e R$ 15.000 a pagar no período, a linha termina em R$ 13.000 — e marca os dias em que o caixa fica negativo.',
  'Achar que a linha é histórico: por padrão ela é projeção (futuro) a partir do saldo de hoje; só vira "realizado" quando não há contas em aberto nos próximos 30 dias.'
)
ON CONFLICT (chave) DO NOTHING;
