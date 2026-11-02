-- DEMO seed (aditivo): o usuário de screenshot das empresas DEMO ganha papel de
-- gestor (CLIENT_MANAGER) nas empresas is_demo, para as telas comerciais
-- (Desempenho, Pipeline/Funil, Ranking etc.) renderizarem o pipeline da EMPRESA
-- em vez de abrirem zeradas.
--
-- Causa-raiz PROVADA (aud8 30/10 + RD-38): fn_crm_desempenho define
--   v_gestor := is_admin()
--     OR EXISTS(tenant_user_roles CLIENT_OWNER/CLIENT_MANAGER na empresa)
--     OR users.role IN (acesso_total,adm,socio);
--   v_vend := CASE WHEN v_gestor THEN p_vendedor ELSE auth.uid() END;
-- e a base filtra "op.responsavel_id = v_vend". O usuário que renderiza a DEMO
-- (screenshot@psgestao.com) é users.role='operacional', sem tenant_user_roles e
-- com 0 oportunidades como responsável -> v_gestor=false, base vazia,
-- INDEPENDENTE do período. Empresa DEMO 006 (Construtora Modelo) tem 19
-- oportunidades (13 abertas + 4 ganhas), todas sem responsável. Com o papel de
-- gestor e p_vendedor=null a base passa a ver o pipeline da empresa.
--
-- Aditivo, idempotente e restrito às empresas is_demo e ao usuário de screenshot.
-- Não remove nem altera papéis existentes; não toca dado de cliente real.
INSERT INTO public.tenant_user_roles (user_id, company_id, role, is_active, observacao)
SELECT u.id, c.id, 'CLIENT_MANAGER', true,
       'seed DEMO: viewer com papel de gestor para as telas comerciais (aud8 30/10)'
FROM public.users u
CROSS JOIN public.companies c
WHERE u.email = 'screenshot@psgestao.com'
  AND c.is_demo IS TRUE
  AND NOT EXISTS (
    SELECT 1 FROM public.tenant_user_roles t
    WHERE t.user_id = u.id
      AND t.company_id = c.id
      AND t.role = 'CLIENT_MANAGER'
  );
