-- migrations/20260512090343_view_titulos_consolidados.sql
-- View consolidada de todos os titulos a pagar + receber.
-- Foundational: serve a aba /dashboard/financeiro/titulos e qualquer
-- outra tela futura que precise visao financeira unificada.
-- RLS herda das tabelas-base via security_barrier.

CREATE OR REPLACE VIEW public.v_titulos_consolidados AS
SELECT
  p.id,
  p.company_id,
  'pagar'::text AS tipo,
  p.descricao,
  p.fornecedor_nome AS contraparte_nome,
  p.fornecedor_id AS contraparte_id,
  p.categoria,
  p.valor,
  p.valor_pago,
  p.data_emissao,
  p.data_vencimento,
  p.data_pagamento,
  p.data_previsao,
  p.status,
  p.numero_documento,
  p.numero_nf,
  p.linha_negocio,
  p.created_at,
  p.updated_at,
  CASE
    WHEN p.status = 'pago' THEN 'pago'
    WHEN p.status = 'cancelado' THEN 'cancelado'
    WHEN p.data_vencimento < CURRENT_DATE THEN 'vencido'
    WHEN p.data_previsao IS NOT NULL AND p.status = 'aberto' THEN 'agendado'
    ELSE 'aberto'
  END AS status_calculado
FROM erp_pagar p
UNION ALL
SELECT
  r.id,
  r.company_id,
  'receber'::text AS tipo,
  r.descricao,
  r.cliente_nome AS contraparte_nome,
  r.cliente_id AS contraparte_id,
  r.categoria,
  r.valor,
  r.valor_pago,
  r.data_emissao,
  r.data_vencimento,
  r.data_pagamento,
  r.data_previsao,
  r.status,
  r.numero_documento,
  r.numero_nf,
  r.linha_negocio,
  r.created_at,
  r.updated_at,
  CASE
    WHEN r.status = 'pago' THEN 'pago'
    WHEN r.status = 'cancelado' THEN 'cancelado'
    WHEN r.data_vencimento < CURRENT_DATE THEN 'vencido'
    WHEN r.data_previsao IS NOT NULL AND r.status = 'aberto' THEN 'agendado'
    ELSE 'aberto'
  END AS status_calculado
FROM erp_receber r;

ALTER VIEW public.v_titulos_consolidados SET (security_barrier = true);

GRANT SELECT ON public.v_titulos_consolidados TO authenticated, service_role;

COMMENT ON VIEW public.v_titulos_consolidados IS
'Visao unificada de erp_pagar + erp_receber. Foundational para /dashboard/financeiro/titulos. status_calculado deriva agendado quando data_previsao definida + status=aberto, antecipando PR #110 integracao Omie.';
