-- Reconciliação do ledger de cobertura §311 (Hub · Agenda, tarefas e avisos) — RD-38 / RD-52
--
-- Doutrina RD-38: "auditar e provar no dado, nunca supor"; o ledger não pode mentir.
-- O requisito 735d21a3 do blueprint vivo da tela 311 está com status_baseline='ausente'
-- mas JÁ ESTÁ IMPLEMENTADO na tela viva — a Agenda comercial do Hub:
--
--   735d21a3  "Agenda comercial no Hub, logo abaixo de Oportunidades, reaproveitando a
--              agenda da área comercial de Produção & Marketing (data, início, fim,
--              lead/oportunidade, responsável, local, endereço, link da reunião, observação)."
--
--   Prova no código:
--     * src/app/dashboard/projetos/agenda/page.tsx — renderiza <AgendaComercialView
--       eyebrow="🗓️ Hub de Projetos · Agenda comercial" />, REAPROVEITANDO o componente
--       compartilhado src/components/agenda/AgendaComercialView.tsx (RD-26 — não recria),
--       o MESMO do P&M (src/app/dashboard/pm/agenda/page.tsx), lendo erp_agendamento
--       origem_modulo='comercial' com RLS por empresa.
--     * Campos no EventoModal (AgendaComercialView.tsx L315-324): titulo, data, hora_inicio
--       (início), hora_fim (fim), leadId (lead/oportunidade via agency_leads), responsavelId
--       (responsável), local, link (link_reuniao) e obs (observação) — todos os campos pedidos.
--     * Visões dia/semana/mês (DiaCol, MesGrid, range) e CRUD completo (criar/editar/mudar
--       status/excluir soft-delete rastreável, RD-98 p4).
--   Prova no menu (module_catalog): "Agenda" rota=/dashboard/projetos/agenda, grupo='hub',
--     subgrupo='projetos_comercial', ordem=110 — imediatamente ABAIXO de "Oportunidades"
--     (ordem=109, mesmo grupo/subgrupo). "logo abaixo de Oportunidades" atendido.
--
-- Esta migration só corrige o ledger (status_baseline ausente -> atendido) DESSE requisito
-- provado. NÃO toca os demais requisitos da 311 genuinamente pendentes (lembretes
-- automáticos, sino de avisos, conflito de agenda, preferência de avisos, tarefa com
-- vínculo a obra, agenda por obra). A marcação ramos_aplicaveis da linha de menu "Agenda"
-- é requisito SEPARADO da 312 (matriz M0 do menu) e não é tocada aqui.
--
-- Valor 'atendido' = o permitido pelo CHECK blueprint_tela_requisito_status_chk
--   {ausente,parcial,atendido,travado}; 'completo' NÃO existe (quebraria o deploy — RD-52).
-- Aditiva e idempotente: guarda por status_baseline='ausente' (re-rodar não altera nada).
-- Sem RLS/policy/grant; blueprint_tela_requisito é ledger interno de cobertura, não é dado
-- de cliente.

UPDATE public.blueprint_tela_requisito
   SET status_baseline = 'atendido'
 WHERE id = '735d21a3-7edb-46d9-8c96-863d7ea161e6'  -- Agenda comercial no Hub, abaixo de Oportunidades
   AND vertical = 'hub_projetos'
   AND tela_num = 311
   AND status_baseline = 'ausente';
