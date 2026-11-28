-- GE · /dashboard/cadastros/clientes — SO-DEMO: higiene da DEMO "Comércio (GE) - DEMO" (b0700000-...-004).
-- Parte 2 da limpeza (ver 20261129211845): os 4 fixtures restantes têm sufixo-hash em MAIÚSCULAS
-- ("CLIENTE 263 36737711530-MUOAVDTL", ...), que a 1ª migration (regex minúsculo, case-sensitive) não casou.
-- São fixtures de teste (prefixo "CLIENTE 263 ", documento nulo) — não é linguagem do cliente (critério e).
--
-- Mesma correção: soft-delete (ativo=false, RD-98 reversível). A lista filtra por `ativo`, não por `excluido_em`.
-- NÃO hard-delete (preserva integridade). Guardas em DOIS níveis (is_demo + id da DEMO GE) + padrão de nome
-- (hífen + 6+ alfanuméricos MAIÚSCULOS no fim). Aditivo e idempotente (RD-97).
-- Os 20 clientes curados da DEMO ("Cliente Demo PF NN", "Comércio Demo N LTDA") NÃO casam e ficam intactos.
-- RD-38 (provado no PR): exatamente 4 alvos; depois = 0 fixtures ativos com sufixo-hash maiúsculo.

UPDATE public.erp_clientes c
SET ativo = false,
    observacoes_internas = COALESCE(NULLIF(c.observacoes_internas, '') || ' ', '')
      || '[higiene DEMO 28/11 · fixture "CLIENTE 263" tirado da lista · desenvolvedor_4_g]'
FROM public.companies co
WHERE co.id = c.company_id
  AND co.is_demo = true
  AND c.company_id = 'b0700000-0000-4000-a000-000000000004'
  AND c.ativo = true
  AND c.excluido_em IS NULL
  AND COALESCE(c.nome_fantasia, c.razao_social) ~ '-[A-Z0-9]{6,}$';
