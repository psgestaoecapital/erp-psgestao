-- View consolidada: erp_pagar + erp_receber no MESMO formato que erp_lancamentos tinha.
-- security_invoker = on => respeita a RLS multi-tenant das tabelas base (Pilar 2).
CREATE OR REPLACE VIEW v_lancamentos_consolidado WITH (security_invoker = on) AS
SELECT p.id, p.company_id, 'pagar'::text AS tipo, NULL::uuid AS cliente_id, p.fornecedor_id,
  p.fornecedor_nome AS nome_pessoa, p.data_emissao::text AS data_emissao, p.data_vencimento::text AS data_vencimento,
  p.data_previsao::text AS data_previsao, p.data_pagamento::text AS data_pagamento, p.valor AS valor_documento,
  p.valor_pago, p.status, p.categoria, NULL::text AS subcategoria, p.centro_custo, p.numero_documento, p.descricao,
  p.recorrente, NULL::text AS frequencia, NULL::integer AS parcela_atual, NULL::integer AS total_parcelas,
  NULL::uuid AS created_by, p.created_at, p.updated_at, p.forma_pagamento, NULL::uuid AS conta_bancaria_id,
  p.juros, p.multa, p.desconto, NULL::text AS anexo_url, p.observacoes AS observacao_interna, NULL::text[] AS tags,
  NULL::uuid AS recorrente_origem_id, NULL::integer AS intervalo_dias, NULL::text AS moeda, NULL::numeric AS valor_moeda_origem,
  NULL::numeric AS taxa_cambio, NULL::uuid AS hierarchy_id, NULL::uuid AS centro_custo_id, NULL::uuid AS business_line_id,
  NULL::text AS plano_conta_codigo, NULL::uuid AS banco_conta_id, p.import_hash
FROM erp_pagar p
UNION ALL
SELECT r.id, r.company_id, 'receber'::text, r.cliente_id, NULL::uuid, r.cliente_nome, r.data_emissao::text,
  r.data_vencimento::text, r.data_previsao::text, r.data_pagamento::text, r.valor, r.valor_pago, r.status, r.categoria,
  NULL::text, r.centro_custo, r.numero_documento, r.descricao, r.recorrente, NULL::text, NULL::integer, NULL::integer,
  NULL::uuid, r.created_at, r.updated_at, r.forma_pagamento, NULL::uuid, r.juros, r.multa, r.desconto, NULL::text,
  r.observacoes, NULL::text[], NULL::uuid, NULL::integer, NULL::text, NULL::numeric, NULL::numeric, NULL::uuid,
  NULL::uuid, NULL::uuid, NULL::text, NULL::uuid, r.import_hash
FROM erp_receber r;

-- Correcao de seguranca: views de aging tambem passam a respeitar RLS multi-tenant
ALTER VIEW v_contas_pagar_aging SET (security_invoker = on);
ALTER VIEW v_contas_receber_aging SET (security_invoker = on);
