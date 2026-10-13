-- FIX-DASHBOARD-GE-DUPLO (07/07 · CEO Opcao B):
-- Registra "Painel Gestao Empresarial" no menu INICIO da area GE
-- apontando pra rota do DashboardRico (/dashboard/gestao-empresarial).
--
-- INCIDENTE: CEO reportou que ao logar caia no dashboard rico
-- (saldo bancario, saude 58/100, conciliacao 441, fluxo caixa) mas
-- depois de navegar entre modulos e voltar clicando no logo, caia
-- em outro dashboard generico (/dashboard/home = Dashboard Universal
-- transversal Commerce/Industrial/Agro/BPO). Duas telas diferentes.
--
-- CAUSA:
-- - Logo do SidebarHeader apontava pra /dashboard/home (generico)
-- - Menu INICIO da RPC nao tinha item apontando pra rota rica
--   (/dashboard/gestao-empresarial). So Consultor IA + Favoritos (placeholder).
-- - Modulos existentes painel_geral/visao_diaria nao tem
--   'gestao_empresarial' em surface_in_groups.
--
-- FIX 1 (deste SQL):
-- Registrar ge_painel_geral apontando pro DashboardRico e vincular
-- ao plano v15_gestao_empresarial_pro na secao INICIO (ordem=1 = TOPO).
--
-- FIX 2 (paralelo · frontend): SidebarHeader.tsx logo -> /dashboard
-- (redirect inteligente, respeita multi-tenant).
--
-- Aplicada via MCP apply_migration em 2026-07-06 (success:true).

INSERT INTO public.module_catalog (id, nome, rota, grupo, subgrupo, ordem, ativo, surface_in_groups)
VALUES ('ge_painel_geral',
        'Painel Gestão Empresarial',
        '/dashboard/gestao-empresarial',
        'gestao_empresarial',
        'inicio',
        1,
        true,
        ARRAY['gestao_empresarial'])
ON CONFLICT (id) DO UPDATE
SET rota = EXCLUDED.rota,
    subgrupo = EXCLUDED.subgrupo,
    grupo = EXCLUDED.grupo,
    surface_in_groups = EXCLUDED.surface_in_groups,
    ordem = EXCLUDED.ordem,
    ativo = true;

INSERT INTO public.plan_modules (plan_id, module_id, is_default_active)
VALUES ('v15_gestao_empresarial_pro', 'ge_painel_geral', true)
ON CONFLICT DO NOTHING;

-- Verificacao empirica pos-fix:
-- fn_modulos_sidebar_por_area('gestao_empresarial', <company_ge>, NULL)
-- secao=INICIO retorna:
--   1. Painel Gestão Empresarial -> /dashboard/gestao-empresarial (ordem 1)
--   2. Consultor IA               -> /dashboard/consultor-ia       (ordem 10)
--   3. Favoritos                  -> /dashboard/gestao-empresarial/previsto/ge_prev_favoritos (ordem 20)
