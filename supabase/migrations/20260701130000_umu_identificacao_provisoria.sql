-- Identificação provisória UMU (agro/pecuária). RECONCILIAÇÃO RD-52: esta versão já está no ledger de produção
-- (aplicada via MCP em 01/07; o arquivo não tinha ido para o repositório). O SQL abaixo é o que a PR #516 registrou.
-- NÃO RE-EXECUTAR EM PRODUÇÃO: hoje há animais sem brinco que receberiam numeração nova. O db push não roda
-- migrations que já estão no ledger, então este arquivo só serve para o repo bater com o banco.
WITH numerados AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY propriedade_id ORDER BY created_at, id) AS rn
  FROM erp_pec_animal
  WHERE company_id='636af107-f11f-4f0c-8aaa-3fd3d0ffdf38'
    AND (identificacao IS NULL OR identificacao='')
)
UPDATE erp_pec_animal a
SET identificacao = 'UMU-' || LPAD(n.rn::text, 4, '0'), updated_at = now()
FROM numerados n
WHERE a.id = n.id;
