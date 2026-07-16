-- ═══════════════════════════════════════════════════════════════════════════
-- HIGIENE DE SETOR — Frioeste (975365cc) — pro RH / Jian
-- NÃO bloqueia o card de Custo por Setor. É correção da DIMENSÃO (ind_pessoa).
-- ⚠️ RD-54: qualquer UPDATE em ind_pessoa (dado de pessoa) precisa autorização do CEO
--    + backup. Este arquivo é DIAGNÓSTICO (SELECT) — não altera nada.
-- ═══════════════════════════════════════════════════════════════════════════

-- 4a. Os "SEM SETOR" reais (junho, já sem pró-labore) — pro RH classificar.
--     Resultado provado em 16/07: 5 matrículas → 40, 340, 838, 929, 1130 (R$ 16.375,20).
--     (965,967,968,969,970,971 são pró-labore — a view já isola como 'PRÓ-LABORE (sócios)'.)
SELECT f.matricula, p.setor
FROM public.folha_competencia f
JOIN public.ind_pessoa p ON p.matricula = f.matricula AND p.company_id = f.company_id
WHERE f.company_id = '975365cc-9e5a-4251-9022-68c6bfde10d8' AND f.competencia = '2026-06-01'
  AND (p.setor IS NULL OR TRIM(p.setor) = '' OR p.setor = '⚠️ SEM SETOR')
  AND f.matricula NOT BETWEEN 965 AND 971          -- pró-labore fica de fora (já isolado na view)
ORDER BY f.matricula;

-- 4b. EXPEDIÇÃO vs EXPEDIÇÃO/ENTREGAS — pro Jian decidir se é 1 área ou 2.
--     Resultado provado em 16/07: EXPEDIÇÃO = 36 pessoas · EXPEDIÇÃO/ENTREGAS = 30 pessoas.
--     Se for a MESMA área (typo/duplicidade), o fix é UPDATE em ind_pessoa.setor (dimensão).
--     ⚠️ RD-54: DML de pessoa → autorização CEO + backup. NÃO resolver na view (RD-52).
SELECT p.setor, count(*) AS qtd, array_agg(p.matricula ORDER BY p.matricula) AS matriculas
FROM public.ind_pessoa p
WHERE p.company_id = '975365cc-9e5a-4251-9022-68c6bfde10d8'
  AND p.setor ILIKE 'EXPEDI%'
GROUP BY p.setor;
