-- P&M/Comercial · Agenda (Fase 1): item de menu pra a nova tela /dashboard/pm/agenda.
-- O sidebar é DB-driven (module_catalog → fn_modulos_sidebar_por_area). Espelha o item "Leads / CRM"
-- (grupo=pm, subgrupo=pm_comercial), entre Leads (ordem 10) e Propostas (ordem 20).
-- A Agenda reusa erp_agendamento (origem_modulo='comercial') — RD-26, sem tabela nova.

INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, descricao)
VALUES ('pm_agenda', 'Agenda', 'pm', 'pm_comercial', 'Calendar', '/dashboard/pm/agenda', 15, true,
        'Agenda comercial — reuniões e compromissos do funil (dia/semana/mês), integrada ao Kanban de leads.')
ON CONFLICT (id) DO NOTHING;
