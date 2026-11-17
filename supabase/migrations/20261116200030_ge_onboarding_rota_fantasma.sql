-- GE · P0 (FILA VIVA GE item 1) — conserto da ROTA-FANTASMA do Onboarding da Gestão Empresarial.
--
-- Diagnóstico aceito (RD-41): o wizard NÃO está quebrado. A rota /dashboard/onboarding/gestao-empresarial
-- (tela "PR #140") foi refatorada para /dashboard/gestao-empresarial/implantacao (conserto #4117 → router
-- + /implantacao), mas a linha em system_screens ficou apontando para a página removida → 404 = 'quebrada'
-- desde 26/05. Não há item de menu (module_catalog) para a rota morta; só um bookmark ou o robô de auditoria
-- a alcança. O wizard /implantacao funciona (fn_ge_onboarding_status devolve os 5 passos na demo GE).
--
-- Conserto (aditivo/corretivo, RD-35 Fase 2): repontar a linha fantasma para a rota viva, marcar 'pronto'
-- (provado) e linkar feature↔tela. O redirect 308 da rota antiga vai no next.config.ts. BlocoSeguro e o
-- nudge "Comece por aqui" (empty-state) vão no front.

-- 1) módulo de catálogo do Guia de Implantação — INATIVO no menu (a entrada é o rodapé "Guia de
--    Implantação" da sidebar, em src/lib/menu/useSidebarModulos.ts). Aqui serve só para a rastreabilidade
--    feature↔tela (feature_catalog.module_id é NOT NULL → module_catalog.id). ativo=false ⇒ não entra no
--    menu e o gatilho de auto-vínculo a planos não dispara.
INSERT INTO public.module_catalog
  (id, nome, rota, ativo, grupo, icone, ordem, subgrupo, descricao, is_shared, so_ps, legacy, so_demo, diferencial, rbac_isento, dependencies, surface_in_groups)
VALUES
  ('ge_implantacao', 'Guia de Implantação', '/dashboard/gestao-empresarial/implantacao', false, 'gestao_empresarial', 'Rocket', 90,
   'inicio', 'Wizard de boas-vindas da Gestão Empresarial (5 passos). Entrada pelo rodapé da sidebar.',
   false, false, false, false, false, false, ARRAY[]::text[], ARRAY[]::text[])
ON CONFLICT (id) DO NOTHING;

-- 2) repontar a linha fantasma para a rota viva (rota é UNIQUE; /implantacao ainda não existe em system_screens)
UPDATE public.system_screens
   SET rota = '/dashboard/gestao-empresarial/implantacao',
       titulo = 'Guia de Implantação (Onboarding GE)',
       estado_real = 'pronto',
       auditavel_robo = true,
       descricao_funcional = 'Wizard de implantação da GE (5 passos): contas bancárias, lançamentos, contratos, plano de contas, DRE divisional. Onboarding de empresa nova.',
       atualizado_em = now()
 WHERE id = 'dashboard.onboarding.gestao_empresarial';

-- 3) feature↔tela
INSERT INTO public.feature_catalog
  (id, module_id, area, titulo, status, percentual_pronto, prioridade, descricao_executiva, descricao_tecnica)
VALUES
  ('F.ge.implantacao', 'ge_implantacao', 'gestao_empresarial', 'Guia de Implantação (Onboarding)', 'pronto', 100, 'alta',
   'Wizard de 5 passos para a empresa começar a usar a Gestão Empresarial.',
   'OnboardingFiveSteps + fn_ge_onboarding_status; entrada pela sidebar e nudge no empty-state.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.screen_route_features (screen_id, feature_id, peso)
VALUES ('dashboard.onboarding.gestao_empresarial', 'F.ge.implantacao', 1)
ON CONFLICT DO NOTHING;

-- 4) ajuda do nudge (RD-95)
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ge.onboarding.nudge', '/dashboard/gestao-empresarial', 'Gestão Empresarial', 'Comece por aqui',
   'Atalho para o Guia de Implantação: os 5 passos para a empresa começar a usar a Gestão Empresarial.',
   'Guia a empresa nova a configurar contas, lançamentos, contratos, plano de contas e DRE — sem travar o resto do sistema.',
   'Clicar em "Abrir o Guia" para cadastrar as contas bancárias e importar os lançamentos.',
   'Achar que precisa terminar tudo antes de usar a GE — não precisa; o guia é opcional e não bloqueia.',
   'gestao_empresarial', 10, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, status = EXCLUDED.status, atualizado_em = now();
