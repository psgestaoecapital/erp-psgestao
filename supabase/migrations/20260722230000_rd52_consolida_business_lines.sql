-- RD-52 — business_lines é a FONTE DA VERDADE das linhas de negócio.
-- A tela de Divisões gravava em linhas_negocio (que o agro NÃO lê). Consolida em business_lines.
-- 1) business_lines ganha cor/descricao (aditivo, pra tela manter o visual).
-- 2) migra as linhas de linhas_negocio → business_lines (de-para por empresa+nome, sem duplicar).
-- 3) NÃO dropa linhas_negocio. RD-54 (backup antes).

ALTER TABLE public.business_lines
  ADD COLUMN IF NOT EXISTS cor text,
  ADD COLUMN IF NOT EXISTS descricao text;

-- backup (RD-54)
CREATE SCHEMA IF NOT EXISTS bkp_rd52_20260722;
CREATE TABLE IF NOT EXISTS bkp_rd52_20260722.linhas_negocio AS TABLE public.linhas_negocio;

-- de-para: só linhas cujo empresa_id existe em companies (as órfãs não têm pra onde ir);
-- pula quem já existe em business_lines (mesma empresa + mesmo nome, case-insensitive);
-- atribui o k-ésimo ln_number LIVRE (1..12) por empresa.
WITH novos AS (
  SELECT ln.id, ln.empresa_id AS company_id, ln.nome AS name, ln.descricao, ln.cor, ln.ativo,
         row_number() OVER (PARTITION BY ln.empresa_id ORDER BY ln.ordem NULLS LAST, ln.nome) AS rk
  FROM public.linhas_negocio ln
  WHERE EXISTS (SELECT 1 FROM public.companies c WHERE c.id = ln.empresa_id)
    AND NOT EXISTS (SELECT 1 FROM public.business_lines bl
                    WHERE bl.company_id = ln.empresa_id AND lower(bl.name) = lower(ln.nome))
),
livres AS (
  SELECT n.company_id, g AS ln_number,
         row_number() OVER (PARTITION BY n.company_id ORDER BY g) AS slot
  FROM (SELECT DISTINCT company_id FROM novos) n
  CROSS JOIN generate_series(1, 12) g
  WHERE NOT EXISTS (SELECT 1 FROM public.business_lines bl
                    WHERE bl.company_id = n.company_id AND bl.ln_number = g)
)
INSERT INTO public.business_lines (company_id, ln_number, name, is_active, cor, descricao)
SELECT nv.company_id, lv.ln_number, nv.name, COALESCE(nv.ativo, true), nv.cor, nv.descricao
FROM novos nv
JOIN livres lv ON lv.company_id = nv.company_id AND lv.slot = nv.rk;
