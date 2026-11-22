-- Hub · Agenda comercial no menu (§312) — auditoria de jornada (auditor_pdca_1, 20/11).
--
-- CONTEXTO (RD-38): a tela /dashboard/projetos/agenda JA EXISTE e funciona na main
--   - page.tsx: src/app/dashboard/projetos/agenda/page.tsx (PR #5715, merged) — casca RD-26 sobre o
--     componente compartilhado AgendaComercialView, MESMO motor da /dashboard/pm/agenda
--     (erp_agendamento origem_modulo='comercial', fn_agendamento_criar/mudar_status/excluir, RLS por
--     empresa, soft-delete; "?" via AJUDA_ROTA fixa);
--   - origem do dado em system_screens (PR #5716, merged).
-- GAP UNICO que bloqueava a entrega (RD-98 pilar MENU / RD-96 checklist #3): a rota NAO estava em
-- module_catalog -> fora do menu -> o usuario do Hub nao chega nela. Hoje so /dashboard/pm/agenda
-- (grupo pm) esta no menu.
--
-- ESTA MIGRATION: adiciona SO a linha de menu do Hub (grupo hub, subgrupo projetos_comercial, logo
-- abaixo de Oportunidades). NAO toca nucleo/RLS/financeiro. module_catalog e catalogo GLOBAL
-- (sem dado de cliente, sem RLS por empresa).
--
-- VINCULO AOS PLANOS: a tabela module_catalog tem o trigger AFTER INSERT trg_modulo_vincular_planos
-- (fn_vincular_modulo_aos_planos), que ao inserir um modulo ATIVO com rota+grupo o vincula
-- automaticamente a todos os planos que ja tem algum modulo do mesmo grupo. Para 'hub' isso cobre
-- v15_hub_t1..t4 (e v15_gestao_empresarial_pro, que ja contem modulos hub) — comportamento padrao de
-- todo modulo hub. O INSERT explicito em plan_modules abaixo (mirror da irma projetos_oportunidades,
-- ON CONFLICT DO NOTHING) e rede de seguranca idempotente para os planos do Hub.
--
-- POSICAO: ordem=110 (banda imediatamente apos Oportunidades, ordem=109). O menu e ordenado por
-- (secao_ordem, ordem); manter a Agenda na mesma banda comercial a deixa logo abaixo de Oportunidades.
--
-- Aditiva e idempotente. RD-38 provado no PR (module_catalog 0->1; plan_modules 0->5
-- {v15_gestao_empresarial_pro, v15_hub_t1..t4}; reexecucao nao duplica).

BEGIN;

-- 1) Modulo de menu: Agenda comercial do Hub.
INSERT INTO public.module_catalog
  (id, nome, grupo, subgrupo, rota, icone, ordem, ativo, legacy, is_shared,
   so_ps, so_demo, surface_in_groups, diferencial, rbac_isento)
VALUES
  ('projetos_agenda', 'Agenda', 'hub', 'projetos_comercial', '/dashboard/projetos/agenda', 'Calendar',
   110, true, false, true, false, false, ARRAY[]::text[], false, false)
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, grupo = EXCLUDED.grupo, subgrupo = EXCLUDED.subgrupo, rota = EXCLUDED.rota,
  icone = EXCLUDED.icone, ordem = EXCLUDED.ordem, ativo = EXCLUDED.ativo, legacy = EXCLUDED.legacy,
  is_shared = EXCLUDED.is_shared, surface_in_groups = EXCLUDED.surface_in_groups;

-- 2) Rede de seguranca: garante os planos do Hub mesmo que o trigger nao rode (ex.: reexecucao via
--    ON CONFLICT DO UPDATE, que e UPDATE e nao dispara o AFTER INSERT). Espelha a irma comercial
--    projetos_oportunidades. Idempotente.
INSERT INTO public.plan_modules (plan_id, module_id, is_default_active, minimum_sla, legacy)
SELECT p.plan_id, 'projetos_agenda', p.is_default_active, p.minimum_sla, false
  FROM public.plan_modules p
 WHERE p.module_id = 'projetos_oportunidades'
   AND p.plan_id LIKE 'v15_hub_%'
ON CONFLICT (plan_id, module_id) DO NOTHING;

COMMIT;
