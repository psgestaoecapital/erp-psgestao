-- ===== ONDA 3.1-fix: CFOP do item vem na otica do EMITENTE (saida).
-- Espelhar p/ entrada antes de classificar (5xxx->1xxx, 6xxx->2xxx,
-- 7xxx->3xxx; sufixo preservado). =====

-- 1) Espelhamento saida->entrada
CREATE OR REPLACE FUNCTION fn_cfop_entrada(p_cfop text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_cfop IS NULL OR length(trim(p_cfop)) < 4 THEN p_cfop
    WHEN left(trim(p_cfop),1)='5' THEN '1'||right(trim(p_cfop),3)
    WHEN left(trim(p_cfop),1)='6' THEN '2'||right(trim(p_cfop),3)
    WHEN left(trim(p_cfop),1)='7' THEN '3'||right(trim(p_cfop),3)
    ELSE trim(p_cfop)  -- ja e entrada (1/2/3)
  END;
$$;

-- 2) Classificacao passa a espelhar antes de consultar a regra
CREATE OR REPLACE FUNCTION fn_estoque_cfop_entra(p_company_id uuid, p_cfop text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT entra_estoque FROM erp_estoque_cfop_regra
   WHERE ativo AND cfop = fn_cfop_entrada(p_cfop)
     AND (company_id = p_company_id OR company_id IS NULL)
   ORDER BY (company_id IS NOT NULL) DESC LIMIT 1;
$$;

-- 3) Expandir seed (otica de entrada; gera 1xxx e 2xxx por sufixo; idempotente)
INSERT INTO erp_estoque_cfop_regra (company_id, cfop, entra_estoque, observacao)
SELECT NULL, pre.p||suf.s, suf.entra, suf.obs
FROM (VALUES ('1'),('2')) AS pre(p)
CROSS JOIN (VALUES
  ('111', true,  'Compra p/ industrializacao por encomenda'),
  ('116', true,  'Compra p/ industrializacao (entrega futura)'),
  ('117', true,  'Compra p/ comercializacao (entrega futura)'),
  ('118', true,  'Compra merc. p/ comercializacao (consignacao mercantil)'),
  ('401', true,  'Compra p/ industrializacao em operacao com ST'),
  ('403', true,  'Compra p/ comercializacao em operacao com ST'),
  ('408', true,  'Compra p/ industrializacao entrega futura (ST)'),
  ('409', true,  'Compra p/ comercializacao entrega futura (ST)'),
  ('406', false, 'Compra bem p/ ativo imobilizado (ST)'),
  ('407', false, 'Compra material uso/consumo (ST)')
) AS suf(s, entra, obs)
WHERE NOT EXISTS (
  SELECT 1 FROM erp_estoque_cfop_regra r WHERE r.company_id IS NULL AND r.cfop = pre.p||suf.s
);

GRANT EXECUTE ON FUNCTION fn_cfop_entrada(text) TO authenticated;
