-- RD-95: "?" no seletor de abas (visões) do Workspace · Produção & Marketing (/dashboard/producao).
-- Os 4 KPIs já têm "?" (pm.jobs.kpi_*); faltava explicar as abas Kanban / Jobs (lista) / Clientes / Timesheet.
-- Um único "?" ao lado do seletor descreve o que cada visão mostra (design PS: controle único de troca de visão).
-- Aditivo: só INSERT de texto (ON CONFLICT (chave) DO NOTHING), nunca altera dado de cliente.
-- Agente code-desenvolvedor-3 (faixa de segundos :35–:44).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES (
  'pm.jobs.abas', 'Jobs', 'Visões (abas)',
  'Troque a visão dos mesmos jobs: Kanban (arrasta o card entre os estágios), Jobs (lista) (tabela com filtros, incluir/editar/excluir), Clientes (carteira da agência) e Timesheet (horas lançadas por job).',
  'Cada aba é uma forma de olhar o mesmo trabalho — Kanban para tocar o fluxo no dia a dia, Lista para buscar/editar em massa, Clientes para a carteira e Timesheet para o esforço (base da margem por job).',
  'Abrir o Kanban para mover um job de "Em produção" para "Em aprovação"; depois a aba Timesheet para ver as horas do mês.',
  'Procurar um job numa aba e achar que sumiu: é a mesma base em todas; confira os filtros da aba antes de concluir que não existe.',
  1, '/dashboard/producao', 'pm', 'publicado'
)
ON CONFLICT (chave) DO NOTHING;
