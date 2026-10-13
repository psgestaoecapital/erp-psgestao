-- AGRO PR-A · Parte 2 — Preenche identificacao provisoria (UMU-0001..)
-- dos animais da UMU (company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38')
-- que estao sem brinco. Sequencial POR PROPRIEDADE (numeracao propria
-- em cada fazenda), idempotente: so pega onde identificacao esta vazio.
-- Sobrescrivivel quando vier brinco real (nao ha constraint que impeca).
--
-- Autorizado pelo CEO em 2026-07-01.
-- Aplicada via MCP em 2026-07-01. Resultado: 1035 animais renumerados.

WITH numerados AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY propriedade_id ORDER BY created_at, id) AS rn
  FROM public.erp_pec_animal
  WHERE company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38'
    AND (identificacao IS NULL OR identificacao='')
)
UPDATE public.erp_pec_animal a
SET identificacao = 'UMU-' || LPAD(n.rn::text, 4, '0'),
    updated_at = now()
FROM numerados n
WHERE a.id = n.id;
