-- Cadastro de verticais na Central de Dev — dev_vertical
-- Catálogo de produto (não tem company_id): a lista de verticais deixa de ser fixa no código
-- (NOME_VERTICAL em src/app/dashboard/dev/page.tsx) e passa a viver no banco. Assim uma vertical
-- nova (ex.: corretora_seguros) aparece na Central de Dev sem tocar em código, e inativar tira da
-- lista sem apagar — o blueprint e o histórico continuam acessíveis.
--
-- RLS: leitura para authenticated; escrita só para is_admin(). Autoria por auth.uid() (default).
-- Sem SECURITY DEFINER (escrita é direta via RLS), logo sem preocupação de fn_guards.
-- RD-52: nome do arquivo = versão do ledger.

CREATE TABLE IF NOT EXISTS public.dev_vertical (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text UNIQUE NOT NULL,
  nome       text NOT NULL,
  descricao  text,
  ativo      boolean NOT NULL DEFAULT true,
  ordem      int NOT NULL DEFAULT 0,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  criado_por uuid DEFAULT auth.uid()
);

ALTER TABLE public.dev_vertical ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer usuário autenticado enxerga o catálogo.
DROP POLICY IF EXISTS dev_vertical_sel ON public.dev_vertical;
CREATE POLICY dev_vertical_sel ON public.dev_vertical
  FOR SELECT TO authenticated
  USING (true);

-- Escrita (INSERT/UPDATE/DELETE): só administradores.
DROP POLICY IF EXISTS dev_vertical_write ON public.dev_vertical;
CREATE POLICY dev_vertical_write ON public.dev_vertical
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Grants (RLS ainda filtra por cima). anon nunca escreve.
REVOKE ALL ON TABLE public.dev_vertical FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.dev_vertical TO authenticated;
GRANT ALL ON TABLE public.dev_vertical TO service_role;

-- Semente: as verticais que já existem (blueprint + documento vivo), preservando corretora_seguros.
-- Nome legível a partir do slug; ordem estável por ordem alfabética. ON CONFLICT preserva edições.
INSERT INTO public.dev_vertical (slug, nome, ordem)
SELECT u.slug,
       initcap(replace(u.slug, '_', ' ')) AS nome,
       (row_number() OVER (ORDER BY u.slug))::int * 10 AS ordem
FROM (
  SELECT DISTINCT vertical AS slug FROM public.blueprint_tela_requisito
  UNION
  SELECT DISTINCT vertical FROM public.erp_documento_vertical
) u
WHERE u.slug IS NOT NULL AND btrim(u.slug) <> ''
ON CONFLICT (slug) DO NOTHING;
