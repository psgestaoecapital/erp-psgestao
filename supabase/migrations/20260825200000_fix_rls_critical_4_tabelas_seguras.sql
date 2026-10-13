-- FIX-RLS-CRITICAL (PR A) · RLS estava DESLIGADO em tabelas que TÊM policy (advisor Supabase CRITICAL).
-- Com RLS desligado, as policies não são aplicadas → tabela aberta. Pilar 2 (Segurança/LGPD).
--
-- Auditoria (RD-38) — antes de dropar as policies permissivas 'true', confirmei que a policy
-- ESCOPADA já existe em cada tabela (senão, ligar RLS esconderia tudo):
--   business_line_config → blc_all: is_admin() OR company_id IN user_company_ids()  [MULTI-TENANT: vazava entre empresas]
--   sugestoes            → sug_all: is_admin() OR user_id = auth.uid()
--   ficha_itens          → fi_all:  is_admin() OR ficha_id ∈ fichas das empresas do usuário
--   plans                → plans_select: SELECT true (catálogo público; writes ficam bloqueados p/ cliente)
--
-- Estratégia (nunca só ligar RLS): (1) remover a policy permissiva 'true'; (2) ligar RLS.
-- Validado em BEGIN/ROLLBACK: as 4 ficam rls_ligado=true mantendo só a policy escopada.
--
-- m16_bom e organizations (policy só is_admin) ficam para PR B: organizations tem write de
-- bootstrap no admin (admin/page.tsx) e m16_bom alimenta a view v_product_cost — auditados à parte.

-- 1) business_line_config (MULTI-TENANT — prioridade, é a que vazava)
DROP POLICY IF EXISTS allow_all_blc ON public.business_line_config;
ALTER TABLE public.business_line_config ENABLE ROW LEVEL SECURITY;

-- 2) sugestoes (escopo por user_id)
DROP POLICY IF EXISTS allow_all_sugestoes ON public.sugestoes;
ALTER TABLE public.sugestoes ENABLE ROW LEVEL SECURITY;

-- 3) ficha_itens (escopo ficha→company, policy já filtra)
ALTER TABLE public.ficha_itens ENABLE ROW LEVEL SECURITY;

-- 4) plans (catálogo público — SELECT liberado por plans_select)
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
