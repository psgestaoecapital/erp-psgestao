-- RD-95 (CEO 08/10): "?" em todo indicador da tela Equipe (P&M) · /dashboard/pm/equipe.
-- O auditor PDCA (aud8 80/95) pediu "fechar RD-95": o bloco "Carga × capacidade" já tem "?" em todos
-- os indicadores, mas os 2 KPIs do topo ("Membros ativos" e "Custo/hora médio") estavam sem ajuda.
-- Este texto define o recorte de cada KPI (sem mexer no cálculo), resolvendo a dúvida sem sair da tela.
-- Aditivo: só texto em erp_ajuda_campo (sem tabela nova, sem RLS, sem dado de cliente). Idempotente (ON CONFLICT chave).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/pm/equipe', 'pm', 'publicado'
FROM (VALUES
 ('pm.equipe.kpi_membros_ativos', 'Equipe · KPIs', 'Membros ativos',
  'Indicador só de leitura: quantas pessoas da equipe estão marcadas como "Ativo" na(s) empresa(s) selecionada(s).',
  'Mostra o tamanho da equipe em operação — a base para a capacidade de horas da agência.',
  '8 membros ativos.',
  'Esperar que conte quem está inativo: membros desmarcados como "Ativo" ficam de fora deste número.',
  1),
 ('pm.equipe.kpi_custo_medio', 'Equipe · KPIs', 'Custo/hora médio',
  'Indicador só de leitura: a média do custo/hora cadastrado de todos os membros da equipe (só aparece para quem vê salário).',
  'Dá uma referência rápida do custo da hora da equipe, que entra no cálculo da margem dos jobs.',
  'Com custos de R$ 40, R$ 60 e R$ 80/h, o custo/hora médio é R$ 60,00/h.',
  'Ler como o custo de uma pessoa específica: é a média da equipe; quem não tem custo cadastrado puxa a média para baixo.',
  2)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;
