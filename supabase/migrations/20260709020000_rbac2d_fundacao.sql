-- FUNDAÇÃO RBAC 2D (genérica: multi-empresa/fonte/indústria). Pilar 2 (segurança).
-- Reusa industrial_plants + compliance_setores + tenant_user_roles (não recria).
-- Dimensões: (A) escopo org vertical (org_unidade, árvore) × (B) domínio/tema (dominio_bi).
-- Acesso = interseção via user_scope; fn_user_pode_ver é o gate único que TODO BI chama.

-- ========================= PARTE 1: org_unidade (árvore adjacency) =========================
CREATE TABLE IF NOT EXISTS public.org_unidade (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES public.org_unidade(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('empresa','planta','area','setor')),
  nome text NOT NULL,
  ordem int NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  ref_tabela text,
  ref_id uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_org_unidade_parent ON public.org_unidade(parent_id);
CREATE INDEX IF NOT EXISTS ix_org_unidade_company ON public.org_unidade(company_id);
CREATE INDEX IF NOT EXISTS ix_org_unidade_ref ON public.org_unidade(ref_tabela, ref_id);
ALTER TABLE public.org_unidade ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_unidade_rls ON public.org_unidade;
CREATE POLICY org_unidade_rls ON public.org_unidade
  USING (company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_unidade TO authenticated;

-- ========================= PARTE 2: dominio_bi (catálogo global) =========================
CREATE TABLE IF NOT EXISTS public.dominio_bi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  nome text NOT NULL,
  ordem int NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  icone text
);
ALTER TABLE public.dominio_bi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dominio_bi_read ON public.dominio_bi;
CREATE POLICY dominio_bi_read ON public.dominio_bi FOR SELECT USING (true);
GRANT SELECT ON public.dominio_bi TO authenticated;
INSERT INTO public.dominio_bi (slug, nome, ordem, icone) VALUES
  ('gente','Gente (RH)',1,'👥'),
  ('manutencao','Manutenção',2,'🔧'),
  ('qualidade','Qualidade',3,'✅'),
  ('sst','Segurança / SST',4,'🦺'),
  ('producao','Produção',5,'🏭'),
  ('financeiro','Financeiro',6,'💰'),
  ('frota','Frota',7,'🚚')
ON CONFLICT (slug) DO NOTHING;

-- ========================= PARTE 3: user_scope (atribuição 2D) =========================
CREATE TABLE IF NOT EXISTS public.user_scope (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  org_unidade_id uuid NOT NULL REFERENCES public.org_unidade(id) ON DELETE CASCADE,
  dominios text[] NOT NULL DEFAULT '{}',
  nivel text NOT NULL DEFAULT 'ver' CHECK (nivel IN ('ver','filtrar','editar')),
  papel_rotulo text,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_user_scope_user ON public.user_scope(user_id);
CREATE INDEX IF NOT EXISTS ix_user_scope_no ON public.user_scope(org_unidade_id);
ALTER TABLE public.user_scope ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_scope_rls ON public.user_scope;
CREATE POLICY user_scope_rls ON public.user_scope
  USING (company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_scope TO authenticated;

-- ========================= PARTE 4: funções =========================
-- Central: TODO BI chama. Gates: empresa -> escopo(nó ou ancestral) -> domínio.
-- PS_ADMIN e CLIENT_OWNER têm bypass (tudo da empresa).
CREATE OR REPLACE FUNCTION public.fn_user_pode_ver(p_user_id uuid, p_org_unidade_id uuid, p_dominio text)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.org_unidade WHERE id = p_org_unidade_id;
  IF v_company IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.system_role = 'PS_ADMIN') THEN
    RETURN true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = p_user_id AND uc.company_id = v_company) THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_user_roles tr
             WHERE tr.user_id = p_user_id AND tr.company_id = v_company
               AND tr.role = 'CLIENT_OWNER' AND tr.is_active) THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    WITH RECURSIVE anc AS (
      SELECT id, parent_id FROM public.org_unidade WHERE id = p_org_unidade_id
      UNION ALL
      SELECT o.id, o.parent_id FROM public.org_unidade o JOIN anc ON o.id = anc.parent_id
    )
    SELECT 1 FROM public.user_scope us
    WHERE us.user_id = p_user_id AND us.ativo
      AND us.org_unidade_id IN (SELECT id FROM anc)
      AND (p_dominio = ANY(us.dominios) OR 'TODOS' = ANY(us.dominios))
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_user_pode_ver(uuid, uuid, text) TO authenticated, service_role;

-- Helper: nós que o user enxerga (pra filtrar listas). Escopo cobre descendentes.
CREATE OR REPLACE FUNCTION public.fn_user_scope_arvore(p_user_id uuid)
 RETURNS SETOF uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.system_role = 'PS_ADMIN') THEN
    RETURN QUERY SELECT id FROM public.org_unidade; RETURN;
  END IF;
  RETURN QUERY
  WITH RECURSIVE
    scope_roots AS (
      SELECT org_unidade_id AS id FROM public.user_scope
      WHERE user_id = p_user_id AND ativo AND org_unidade_id IS NOT NULL
    ),
    descen AS (
      SELECT id FROM public.org_unidade WHERE id IN (SELECT id FROM scope_roots)
      UNION ALL
      SELECT o.id FROM public.org_unidade o JOIN descen d ON o.parent_id = d.id
    )
  SELECT id FROM descen
  UNION
  SELECT id FROM public.org_unidade
  WHERE company_id IN (SELECT company_id FROM public.tenant_user_roles
                       WHERE user_id = p_user_id AND role = 'CLIENT_OWNER' AND is_active);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_user_scope_arvore(uuid) TO authenticated, service_role;

-- ========================= POPULATE (reusa o existente, idempotente) =========================
INSERT INTO public.org_unidade (company_id, tipo, nome, ordem)
SELECT c.id, 'empresa', COALESCE(c.nome_fantasia, c.razao_social, c.id::text), 0
FROM public.companies c
WHERE c.id IN (
  SELECT company_id FROM public.industrial_plants
  UNION SELECT company_id FROM public.compliance_setores WHERE company_id IS NOT NULL
)
AND NOT EXISTS (SELECT 1 FROM public.org_unidade o WHERE o.company_id=c.id AND o.tipo='empresa');

INSERT INTO public.org_unidade (parent_id, company_id, tipo, nome, ordem, ref_tabela, ref_id)
SELECT e.id, p.company_id, 'planta', p.nome_planta, 0, 'industrial_plants', p.id
FROM public.industrial_plants p
JOIN public.org_unidade e ON e.company_id = p.company_id AND e.tipo='empresa'
WHERE p.is_active IS DISTINCT FROM false
  AND NOT EXISTS (SELECT 1 FROM public.org_unidade o WHERE o.ref_tabela='industrial_plants' AND o.ref_id=p.id);

INSERT INTO public.org_unidade (parent_id, company_id, tipo, nome, ordem, ref_tabela, ref_id)
SELECT
  COALESCE(
    (SELECT po.id FROM public.org_unidade po WHERE po.tipo='planta' AND po.company_id=s.company_id ORDER BY po.criado_em LIMIT 1),
    (SELECT eo.id FROM public.org_unidade eo WHERE eo.tipo='empresa' AND eo.company_id=s.company_id LIMIT 1)
  ),
  s.company_id, 'setor', s.nome, COALESCE(s.ordem_exibicao,0), 'compliance_setores', s.id
FROM public.compliance_setores s
WHERE s.company_id IS NOT NULL AND s.ativo
  AND EXISTS (SELECT 1 FROM public.org_unidade o WHERE o.tipo='empresa' AND o.company_id=s.company_id)
  AND NOT EXISTS (SELECT 1 FROM public.org_unidade o WHERE o.ref_tabela='compliance_setores' AND o.ref_id=s.id);
