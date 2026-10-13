-- Financeiro · soft-delete respeitado nas superfícies que BYPASSAM RLS. Fronteira GE (Pilar 1).
--
-- Contexto (RD-38): erp_pagar/erp_receber já têm RLS SELECT que filtra deleted_at IS NULL, então
-- leitura via client do browser JÁ está protegida. Os vazamentos reais são onde o RLS é bypassado:
-- VIEWs sem security_invoker e funções SECURITY DEFINER. Estas 3 não tinham o filtro:
--  • v_titulos_consolidados (tela de Títulos: lista + KPIs) — roda como owner, bypassa RLS.
--  • fn_psgc_dre_horizontal_dia / fn_psgc_dre_diario (DRE horizontal + drill) — SECURITY DEFINER.

-- 1) VIEW de títulos: adiciona o filtro deleted_at nas duas pernas do UNION.
CREATE OR REPLACE VIEW public.v_titulos_consolidados AS
 SELECT p.id, p.company_id, 'pagar'::text AS tipo, p.descricao,
    p.fornecedor_nome AS contraparte_nome, p.fornecedor_id AS contraparte_id, p.categoria,
    p.valor, p.valor_pago, p.data_emissao, p.data_vencimento, p.data_pagamento, p.data_previsao,
    p.status, p.numero_documento, p.numero_nf, p.linha_negocio, p.created_at, p.updated_at,
    CASE
      WHEN p.status::text = 'pago'::text AND p.conciliado THEN 'conciliado'::text
      WHEN p.status::text = 'pago'::text THEN 'pago'::text
      WHEN p.status::text = 'cancelado'::text THEN 'cancelado'::text
      WHEN p.status::text = 'incluido_remessa'::text THEN 'incluido_remessa'::text
      WHEN p.status::text = 'agendado'::text THEN 'agendado'::text
      WHEN p.data_vencimento < CURRENT_DATE THEN 'vencido'::text
      WHEN p.data_previsao IS NOT NULL AND p.status::text = 'aberto'::text THEN 'agendado'::text
      ELSE 'aberto'::text
    END AS status_calculado,
    p.conciliado
   FROM erp_pagar p
  WHERE p.deleted_at IS NULL
UNION ALL
 SELECT r.id, r.company_id, 'receber'::text AS tipo, r.descricao,
    r.cliente_nome AS contraparte_nome, r.cliente_id AS contraparte_id, r.categoria,
    r.valor, r.valor_pago, r.data_emissao, r.data_vencimento, r.data_pagamento, r.data_previsao,
    r.status, r.numero_documento, r.numero_nf, r.linha_negocio, r.created_at, r.updated_at,
    CASE
      WHEN r.status::text = 'pago'::text AND r.conciliado THEN 'conciliado'::text
      WHEN r.status::text = 'pago'::text THEN 'pago'::text
      WHEN r.status::text = 'cancelado'::text THEN 'cancelado'::text
      WHEN r.status::text = 'incluido_remessa'::text THEN 'incluido_remessa'::text
      WHEN r.status::text = 'agendado'::text THEN 'agendado'::text
      WHEN r.data_vencimento < CURRENT_DATE THEN 'vencido'::text
      WHEN r.data_previsao IS NOT NULL AND r.status::text = 'aberto'::text THEN 'agendado'::text
      ELSE 'aberto'::text
    END AS status_calculado,
    r.conciliado
   FROM erp_receber r
  WHERE r.deleted_at IS NULL;

-- 2) DRE (SECURITY DEFINER): injeta AND <alias>.deleted_at IS NULL nas leituras de dinheiro.
-- Programático (mesmo técnica do fix 20260814180000): pega a def atual e acrescenta o filtro nas
-- cláusulas WHERE das leituras de erp_receber (alias r) e erp_pagar (alias p). As strings
-- 'r.company_id = ANY(p_company_ids)' / 'p.company_id = ANY(p_company_ids)' só aparecem nos WHERE
-- externos das leituras de valores — os LATERAL usam 'pd.company_id = r.company_id' (não casam).
DO $mig$
DECLARE d text;
BEGIN
  FOREACH d IN ARRAY ARRAY[
    'public.fn_psgc_dre_horizontal_dia(uuid[],integer,integer,text)',
    'public.fn_psgc_dre_diario(uuid[],text,integer,integer,text)'
  ] LOOP
    d := pg_get_functiondef(d::regprocedure);
    -- idempotente: só injeta se ainda não tem o filtro (evita duplicar em re-run/ambiente já corrigido).
    IF d NOT ILIKE '%r.deleted_at IS NULL%' THEN
      d := replace(d, 'r.company_id = ANY(p_company_ids)', 'r.company_id = ANY(p_company_ids) AND r.deleted_at IS NULL');
    END IF;
    IF d NOT ILIKE '%p.deleted_at IS NULL%' THEN
      d := replace(d, 'p.company_id = ANY(p_company_ids)', 'p.company_id = ANY(p_company_ids) AND p.deleted_at IS NULL');
    END IF;
    EXECUTE d;
  END LOOP;
END
$mig$;
