-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ RD-41 · Fase 1 (Parte 1) · base de delegacao do CLIENT_OWNER         ║
-- ║ Eng Chefe → Code Web · seguranca (Pilar 2)                            ║
-- ║                                                                       ║
-- ║ Entrega:                                                              ║
-- ║   1. helper is_client_owner(company_id) · SECURITY DEFINER            ║
-- ║   2. RLS em tenant_user_roles (achado critico: estava DESABILITADO)  ║
-- ║   3. policies: PS_ADMIN all · self read · owner read da empresa      ║
-- ║   4. role_permissions: CLIENT_OWNER ganha CRUD em convidar_usuarios   ║
-- ║   5. fn_owner_atribuir_usuario com 3 guards (owner/PS · papel)        ║
-- ║                                                                       ║
-- ║ Pilar 2: sem segredos · isolamento garantido por RLS+RPC              ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ═══ 1. HELPER: quem e owner desta empresa ═══
CREATE OR REPLACE FUNCTION public.is_client_owner(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenant_user_roles
    WHERE user_id = auth.uid()
      AND company_id = p_company_id
      AND role = 'CLIENT_OWNER'
      AND is_active
  );
$$;

COMMENT ON FUNCTION public.is_client_owner(uuid) IS
  'RD-41 · true se auth.uid() e CLIENT_OWNER ativo da empresa p_company_id.';

REVOKE ALL ON FUNCTION public.is_client_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_client_owner(uuid) TO authenticated;

-- ═══ 2. RLS em tenant_user_roles (fecha o furo) ═══
ALTER TABLE public.tenant_user_roles ENABLE ROW LEVEL SECURITY;

-- idempotencia: derruba se ja existir
DROP POLICY IF EXISTS tur_ps_all       ON public.tenant_user_roles;
DROP POLICY IF EXISTS tur_self_read    ON public.tenant_user_roles;
DROP POLICY IF EXISTS tur_owner_read   ON public.tenant_user_roles;

-- PS (plataforma) enxerga e gere tudo
CREATE POLICY tur_ps_all ON public.tenant_user_roles
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- usuario enxerga o proprio papel (em qualquer empresa)
CREATE POLICY tur_self_read ON public.tenant_user_roles
  FOR SELECT
  USING (user_id = auth.uid());

-- owner enxerga os papeis da PROPRIA empresa (leitura)
-- Escrita do owner NAO e via policy direta · so pela RPC abaixo (SECURITY
-- DEFINER) que valida tudo. Isso evita atribuicao crua sem guard.
CREATE POLICY tur_owner_read ON public.tenant_user_roles
  FOR SELECT
  USING (public.is_client_owner(company_id));

-- ═══ 3. CLIENT_OWNER ganha CRUD em convidar_usuarios ═══
-- (escopo controlado por RLS+RPC · NAO concede approve nem admin_painel)
INSERT INTO public.role_permissions (role, module_id, action, is_allowed)
SELECT 'CLIENT_OWNER', v.module_id, v.action, true
FROM (VALUES
  ('convidar_usuarios','read'),
  ('convidar_usuarios','create'),
  ('convidar_usuarios','update'),
  ('convidar_usuarios','delete')
) v(module_id, action)
WHERE NOT EXISTS (
  SELECT 1 FROM public.role_permissions rp
  WHERE rp.role='CLIENT_OWNER'
    AND rp.module_id=v.module_id
    AND rp.action=v.action
);

-- ═══ 4. RPC: atribuir usuario com todos os guards ═══
CREATE OR REPLACE FUNCTION public.fn_owner_atribuir_usuario(
  p_company_id uuid,
  p_user_id    uuid,
  p_role       text,
  p_ativar     boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existe boolean;
BEGIN
  -- guard 1: caller e owner da empresa-alvo OU PS admin
  IF NOT (public.is_admin() OR public.is_client_owner(p_company_id)) THEN
    RAISE EXCEPTION 'sem permissao para gerir usuarios desta empresa'
      USING ERRCODE = '42501';
  END IF;

  -- guard 2: jamais cria papel de plataforma
  IF p_role IN ('PS_ADMIN','PS_SUPPORT') THEN
    RAISE EXCEPTION 'nao permitido atribuir papel de plataforma'
      USING ERRCODE = '42501';
  END IF;

  -- guard 3: papel precisa ser de escopo empresa
  IF p_role NOT IN ('CLIENT_OWNER','CLIENT_MANAGER','CLIENT_OPERATOR','CLIENT_VIEWER') THEN
    RAISE EXCEPTION 'papel invalido: %', p_role
      USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM tenant_user_roles
    WHERE user_id = p_user_id AND company_id = p_company_id
  ) INTO v_existe;

  IF v_existe THEN
    UPDATE tenant_user_roles
       SET role        = p_role,
           is_active   = p_ativar,
           assigned_by = auth.uid(),
           updated_at  = now()
     WHERE user_id = p_user_id AND company_id = p_company_id;
  ELSE
    INSERT INTO tenant_user_roles (user_id, company_id, role, is_active, assigned_by)
    VALUES (p_user_id, p_company_id, p_role, p_ativar, auth.uid());
  END IF;

  RETURN jsonb_build_object(
    'ok',      true,
    'acao',    CASE WHEN v_existe THEN 'atualizado' ELSE 'criado' END,
    'user',    p_user_id,
    'role',    p_role,
    'empresa', p_company_id,
    'ativo',   p_ativar
  );
END $$;

COMMENT ON FUNCTION public.fn_owner_atribuir_usuario(uuid,uuid,text,boolean) IS
  'RD-41 · atribuicao de papel CLIENT_* por owner ou PS_ADMIN. Bloqueia papel '
  'de plataforma e empresa alheia. assigned_by=auth.uid() em todo registro.';

REVOKE ALL ON FUNCTION public.fn_owner_atribuir_usuario(uuid,uuid,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_owner_atribuir_usuario(uuid,uuid,text,boolean) TO authenticated;
