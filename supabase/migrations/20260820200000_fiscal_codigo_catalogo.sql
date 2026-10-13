-- Catálogo fiscal pesquisável (NBS + LC116) — estilo OMIE. Fronteira GE (cadastros/fiscal).
--
-- Rodrigo quer buscar o Código NBS (por código ou descrição) em vez de decorar. Greenfield:
-- não existe catálogo NBS/LC116 no banco (RD-26 confirmado — nenhuma tabela nbs/lc116).
--
-- Decisão (CEO): tabela GENÉRICA fiscal_codigo_catalogo com `tipo` ('nbs'|'lc116'), pra o LC116
-- (que dirige o ISS da NFS-e) reusar a mesma estrutura sem retrabalho. E por ora só a INFRA —
-- a carga oficial (~1.000+ códigos federais) vem depois; aqui vão poucas linhas de EXEMPLO
-- pra validar a busca (marcadas como seed; NÃO são a lista oficial — não usar como autoritativo).
--
-- RD-52: catálogo único global (sem company_id), não texto solto. O serviço grava só o `codigo`;
-- a descrição é resolvida pela busca (denormalização opcional fica pro front, sem nova coluna).

CREATE TABLE IF NOT EXISTS public.fiscal_codigo_catalogo (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo       text NOT NULL CHECK (tipo IN ('nbs','lc116')),
  codigo     text NOT NULL,
  descricao  text NOT NULL,
  capitulo   text,                                  -- agrupamento/hierarquia opcional
  ativo      boolean NOT NULL DEFAULT true,
  seed       boolean NOT NULL DEFAULT false,        -- true = exemplo de validação (não oficial)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tipo, codigo)
);

-- Prefixo de código (text_pattern_ops p/ ILIKE 'x%') + busca por descrição (catálogo pequeno → ILIKE basta).
CREATE INDEX IF NOT EXISTS idx_fiscal_cat_tipo_codigo ON public.fiscal_codigo_catalogo (tipo, codigo text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_fiscal_cat_tipo_ativo   ON public.fiscal_codigo_catalogo (tipo, ativo);

ALTER TABLE public.fiscal_codigo_catalogo ENABLE ROW LEVEL SECURITY;
-- Catálogo global de referência: leitura livre pra autenticado; escrita só admin PS (Pilar 2 / RD-25).
DROP POLICY IF EXISTS fiscal_cat_read ON public.fiscal_codigo_catalogo;
CREATE POLICY fiscal_cat_read  ON public.fiscal_codigo_catalogo FOR SELECT USING (true);
DROP POLICY IF EXISTS fiscal_cat_write ON public.fiscal_codigo_catalogo;
CREATE POLICY fiscal_cat_write ON public.fiscal_codigo_catalogo FOR ALL USING (is_admin()) WITH CHECK (is_admin());
REVOKE ALL ON public.fiscal_codigo_catalogo FROM anon;

-- ── Busca pro autocomplete (serve NBS e LC116 pelo mesmo caminho) ──────────────
CREATE OR REPLACE FUNCTION public.fn_catalogo_fiscal_buscar(
  p_tipo text,
  p_termo text DEFAULT NULL,
  p_limite int DEFAULT 30
)
RETURNS TABLE(codigo text, descricao text, capitulo text, seed boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT c.codigo, c.descricao, c.capitulo, c.seed
  FROM public.fiscal_codigo_catalogo c
  WHERE c.tipo = p_tipo AND c.ativo
    AND ( p_termo IS NULL OR btrim(p_termo) = ''
       OR c.codigo ILIKE '%' || btrim(p_termo) || '%'
       OR c.descricao ILIKE '%' || btrim(p_termo) || '%' )
  ORDER BY
    (c.codigo ILIKE btrim(COALESCE(p_termo, '')) || '%') DESC,   -- prefixo de código primeiro
    c.codigo
  LIMIT LEAST(COALESCE(p_limite, 30), 100);
$function$;

REVOKE ALL ON FUNCTION public.fn_catalogo_fiscal_buscar(text, text, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_catalogo_fiscal_buscar(text, text, int) TO authenticated;

-- ── Seed de EXEMPLO (não oficial) — só pra validar a busca; substituir pela carga oficial. ──
INSERT INTO public.fiscal_codigo_catalogo (tipo, codigo, descricao, capitulo, seed) VALUES
  ('nbs', '1.0107.20.00', 'Serviços de gesso e de estuque',                 'Construção', true),
  ('nbs', '1.0107.21.00', 'Serviços de aplicação de revestimento de gesso', 'Construção', true),
  ('nbs', '1.0101.00.00', 'Serviços de construção de edifícios',            'Construção', true),
  ('nbs', '1.1201.10.00', 'Serviços de consultoria em gestão empresarial',  'Serviços profissionais', true),
  ('nbs', '1.0906.00.00', 'Serviços de manutenção e reparo mecânico',       'Manutenção', true)
ON CONFLICT (tipo, codigo) DO NOTHING;
