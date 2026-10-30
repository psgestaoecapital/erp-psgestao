-- Hub · Simulador: a DEMO Construtora (006) não tinha erp_precificacao_config e o motor das 5 camadas
-- devolvia 'sem_config_precificacao' (tela morta no 1º paint). Seed ADITIVO e idempotente das premissas
-- de precificação da empresa DEMO (empresa toda, business_line_id NULL). Não altera dado de cliente real.
INSERT INTO public.erp_precificacao_config
 (company_id, business_line_id, custo_folha_hora, tempo_m2_min, imposto_mo_pct, margem_mo_pct,
  margem_material_pct, icms_pct, pis_cofins_pct, creditos_pct, comissao_pct, meta_producao_m2, base_custo_fixo, ativo, observacao)
SELECT 'b0700000-0000-4000-a000-000000000006'::uuid, NULL, 25, 80, 10, 20, 10, 17, 9.3, 4.0, 3, 5000, 'meta', true,
       'Seed DEMO Hub (premissas realistas p/ o simulador das 5 camadas)'
WHERE EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-000000000006')
  AND NOT EXISTS (SELECT 1 FROM public.erp_precificacao_config
                   WHERE company_id = 'b0700000-0000-4000-a000-000000000006' AND business_line_id IS NULL AND ativo);
