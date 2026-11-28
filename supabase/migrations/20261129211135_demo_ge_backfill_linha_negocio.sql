-- 20261125060035 · code-desenvolvedor-3 · PDCA 22/11 (msg c43dd714) · jornada 4 do CEO
-- Backfill one-time de linha_negocio nos títulos de SEED da DEMO GE (004), para a jornada
-- "resultado por negócio → DRE por divisão → fluxo divisional" mostrar as 5 divisões.
--
-- Causa (provado no dado, RD-38, 23/11):
--   • fn_demo_seed_ge_financeiro JÁ distribui linha_negocio em round-robin pelas business_lines
--     ATIVAS (bloco "RESULTADO POR NEGÓCIO"), mas a DEMO GE de produção não é resetada e os 11
--     títulos DEMO-GE-FIN vivos estão com linha_negocio vazia → fn_ge_resultado_por_negocio_calc
--     classifica só por centro_custo e mostra apenas 2 das 5 divisões ("Geral", "Comercial").
--   • centro_custo_id (uuid) NÃO é lido por nenhuma função de resultado/DRE/divisão/fluxo/rateio
--     (confirmado em pg_get_functiondef), então não é gap: o cálculo usa centro_custo (texto) +
--     linha_negocio. sem_negocio.receita já é 0.
--
-- Prova (BEGIN…ROLLBACK, antes desta migration): aplicar o round-robin abaixo leva
-- fn_ge_resultado_por_negocio_calc de 2 → 5 negócios (Geral, Comercial, Varejo, Atacado,
-- Serviços), mantendo sem_negocio.receita = 0.
--
-- SÓ-DEMO: guardado por companies.is_demo = true; só títulos de SEED (prefixos DEMO-GE-FIN/PED-ORC).
-- Aditiva e idempotente: o round-robin é determinístico (ordena por numero_documento, id), então
-- reaplicar reproduz a MESMA atribuição; converge com o que o fn_demo_seed_ge_financeiro faz no reset.
-- Nunca toca dado de cliente nem título real.

WITH bl AS (
  SELECT name, (row_number() OVER (ORDER BY ln_number, id)) - 1 AS idx, count(*) OVER () AS n
  FROM public.business_lines
  WHERE company_id = 'b0700000-0000-4000-a000-000000000004'::uuid AND is_active
),
tit AS (
  SELECT id, (row_number() OVER (ORDER BY numero_documento, id)) - 1 AS rn
  FROM public.erp_receber
  WHERE company_id = 'b0700000-0000-4000-a000-000000000004'::uuid
    AND deleted_at IS NULL
    AND (numero_documento LIKE 'DEMO-GE-FIN%' OR numero_documento LIKE 'PED-ORC%')
    AND EXISTS (SELECT 1 FROM public.companies c
                 WHERE c.id = 'b0700000-0000-4000-a000-000000000004'::uuid AND c.is_demo = true)
)
UPDATE public.erp_receber r
   SET linha_negocio = bl.name, updated_at = now()
  FROM tit, bl
 WHERE r.id = tit.id
   AND bl.idx = (tit.rn % bl.n);
