-- FIX-RLS-CRITICAL (PR B) · as 2 tabelas sensíveis do advisor (policy só is_admin, RLS desligado).
-- Segue o PR A. Pilar 2 (Segurança/LGPD).

-- ── m16_bom ──────────────────────────────────────────────────────────────────────────────
-- policy m16_all = is_admin(). Auditoria (RD-38): ZERO leitura no frontend (nem direta, nem via a
-- view v_product_cost — que também não é usada no frontend). Catálogo interno → seguro ligar RLS.
ALTER TABLE public.m16_bom ENABLE ROW LEVEL SECURITY;

-- ── organizations ────────────────────────────────────────────────────────────────────────
-- policy org_all = is_admin(). PORÉM o bootstrap (admin/page.tsx · criarEmpresa) insere a org ANTES
-- de o usuário virar role='adm', e a tela admin é acessível a um conjunto MAIOR que is_admin():
--   is_admin() = role IN ('adm','acesso_total')
--   guard da tela = role IN ('adm','acesso_total','adm_investimentos') OU system_role IS NOT NULL
-- Ex.: usuário PS_SUPPORT (role='socio' + system_role) entra na tela mas is_admin()=false → o INSERT
-- da org falharia sob RLS. Então adiciono uma policy de INSERT que cobre EXATAMENTE esses
-- administradores (mesmos critérios da tela), e só então ligo o RLS.
DROP POLICY IF EXISTS org_bootstrap_admin_insert ON public.organizations;
CREATE POLICY org_bootstrap_admin_insert ON public.organizations
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND (u.role IN ('adm','acesso_total','adm_investimentos') OR u.system_role IS NOT NULL)
    )
  );

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
