-- Demo-fidelidade (RD-98 p1): reconcilia o SEED de NF-e recebidas da DEMO "Comércio (GE)".
-- Auditoria auditor_pdca_2 18/11 provou no dado que as RPCs estão CORRETAS (fn_nfe_recebida_concluir
-- roda estoque+pagar ANTES de carimbar concluida_em) — logo o estado abaixo NÃO pode ter saído da função:
--   • 278 NF-e status='completa' com estoque_status='pendente', lancado_pagar=false e 0 itens
--     (origem focus_distribuicao/seed): são RESUMOS de distribuição carimbados direto pelo seed.
--   • NF 1001 (seed_demo_ge): status='lancada', lancado_pagar=true, porém 0 título em erp_pagar e 0 itens.
-- Correção: devolver esses registros ao estado HONESTO de pré-entrada ('aguardando_xml', sem carimbo de
-- conclusão), para não exibir "concluída"/"lançada" sem lastro. Os 3 exemplos coerentes ponta a ponta
-- (NF 900000001/2/3, origem demo_seed_estoque, 'lancada' com estoque completo + título) NÃO são tocados.
--
-- ESCOPO: SÓ a empresa DEMO b0700000-0000-4000-a000-000000000004. Aditivo/idempotente, reversível,
-- NÃO apaga linha, NÃO toca dado de cliente real nem título pago (não há título nestes casos).

-- 1) Resumos de distribuição falsamente "completa" (sem itens, sem estoque, sem título) → aguardando_xml.
UPDATE public.erp_nfe_recebidas c
SET status = 'aguardando_xml',
    concluida_em = NULL,
    concluida_por = NULL,
    updated_at = now()
WHERE c.company_id = 'b0700000-0000-4000-a000-000000000004'
  AND c.status = 'completa'
  AND c.estoque_status = 'pendente'
  AND c.lancado_pagar = false
  AND NOT EXISTS (SELECT 1 FROM public.erp_nfe_recebidas_itens i WHERE i.nfe_recebida_id = c.id);

-- 2) NF 1001 (seed): marcada lancada/lancado_pagar sem título nem itens → estado honesto pré-entrada.
UPDATE public.erp_nfe_recebidas c
SET status = 'aguardando_xml',
    lancado_pagar = false,
    concluida_em = NULL,
    concluida_por = NULL,
    updated_at = now()
WHERE c.company_id = 'b0700000-0000-4000-a000-000000000004'
  AND c.numero = '1001'
  AND c.origem = 'seed_demo_ge'
  AND c.status = 'lancada'
  AND c.lancado_pagar = true
  AND c.estoque_status = 'pendente'
  AND NOT EXISTS (SELECT 1 FROM public.erp_nfe_recebidas_itens i WHERE i.nfe_recebida_id = c.id);
