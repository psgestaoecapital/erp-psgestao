-- DEMO-F1 · Isolamento de tenants demo/sandbox — FUNDAÇÃO (§1).
-- Problema: o tenant demo (Mecanica Modelo) está em produção com is_demo=true, mas a flag
-- não corta nada — quem corta são as queries. Esta migration cria a RÉGUA CANÔNICA (RD-52);
-- os pontos de uso são poucos e escolhidos (não varredura), aplicados em migrations seguintes.
-- Auditado (RD-38): is_demo NÃO tem dependência (0 policies/views/gencols) — seguro mantê-la plana.

-- 1.1 · Três estados, não dois. producao | demo | sandbox
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS ambiente_tenant text NOT NULL DEFAULT 'producao';
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_ambiente_tenant_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_ambiente_tenant_check
  CHECK (ambiente_tenant IN ('producao','demo','sandbox'));
COMMENT ON COLUMN public.companies.ambiente_tenant IS
  'producao = cliente real. demo = apresentacao comercial, dado ficticio, congelado. sandbox = teste interno, pode sujar. demo e sandbox NUNCA entram em numero consolidado, MRR, auditoria ou apuracao fiscal.';

-- 1.2 · Migra a flag antiga. is_demo fica plana e OBSOLETA (não derrubar agora — RD-30, §7 fora de escopo).
UPDATE public.companies SET ambiente_tenant = 'demo' WHERE is_demo = true AND ambiente_tenant = 'producao';
COMMENT ON COLUMN public.companies.is_demo IS
  'OBSOLETA — usar ambiente_tenant. Mantida temporariamente para compatibilidade.';

CREATE INDEX IF NOT EXISTS idx_companies_ambiente
  ON public.companies(ambiente_tenant) WHERE ambiente_tenant <> 'producao';

-- 1.3 · A RÉGUA CANÔNICA — um lugar só (RD-52). Toda agregação gerencial filtra por aqui.
CREATE OR REPLACE FUNCTION public.fn_empresas_produtivas()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT id FROM public.companies WHERE ambiente_tenant = 'producao';
$$;
COMMENT ON FUNCTION public.fn_empresas_produtivas IS
  'Fonte unica de verdade para "quais empresas contam". Toda agregacao gerencial filtra por aqui.';

CREATE OR REPLACE VIEW public.companies_producao WITH (security_invoker=on) AS
  SELECT * FROM public.companies WHERE ambiente_tenant = 'producao';

GRANT EXECUTE ON FUNCTION public.fn_empresas_produtivas() TO authenticated, service_role;
GRANT SELECT ON public.companies_producao TO authenticated, service_role;
