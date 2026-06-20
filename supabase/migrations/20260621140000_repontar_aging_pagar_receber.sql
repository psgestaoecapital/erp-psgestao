-- Repontar views de aging: erp_lancamentos (legado, agora vazio) -> erp_pagar / erp_receber
-- Fonte de verdade do financeiro = erp_pagar / erp_receber.
-- DROP+CREATE necessario (tipos de coluna mudam: data text->date). Nada depende destas views (auditado).

DROP VIEW IF EXISTS v_contas_pagar_aging;
CREATE VIEW v_contas_pagar_aging AS
SELECT
  p.id,
  p.company_id,
  c.nome_fantasia AS empresa,
  p.fornecedor_nome AS fornecedor,
  p.fornecedor_id,
  p.descricao,
  p.valor,
  p.data_emissao,
  p.data_vencimento,
  p.status,
  (CURRENT_DATE - p.data_vencimento) AS dias_atraso,
  CASE
    WHEN p.status = 'pago' THEN 'pago'
    WHEN p.status = 'cancelado' THEN 'cancelado'
    WHEN p.data_vencimento >= CURRENT_DATE THEN 'em_dia'
    WHEN (CURRENT_DATE - p.data_vencimento) BETWEEN 1 AND 15 THEN 'atraso_1_15'
    WHEN (CURRENT_DATE - p.data_vencimento) BETWEEN 16 AND 30 THEN 'atraso_16_30'
    WHEN (CURRENT_DATE - p.data_vencimento) BETWEEN 31 AND 60 THEN 'atraso_31_60'
    WHEN (CURRENT_DATE - p.data_vencimento) BETWEEN 61 AND 90 THEN 'atraso_61_90'
    WHEN (CURRENT_DATE - p.data_vencimento) > 90 THEN 'atraso_mais_90'
    ELSE 'indefinido'
  END AS faixa_aging
FROM erp_pagar p
LEFT JOIN companies c ON c.id = p.company_id
WHERE p.status <> 'cancelado';

DROP VIEW IF EXISTS v_contas_receber_aging;
CREATE VIEW v_contas_receber_aging AS
SELECT
  r.id,
  r.company_id,
  c.nome_fantasia AS empresa,
  r.cliente_nome AS cliente,
  r.cliente_id,
  r.descricao,
  r.valor,
  r.data_emissao,
  r.data_vencimento,
  r.status,
  (CURRENT_DATE - r.data_vencimento) AS dias_atraso,
  CASE
    WHEN r.status = 'pago' THEN 'pago'
    WHEN r.status = 'cancelado' THEN 'cancelado'
    WHEN r.data_vencimento >= CURRENT_DATE THEN 'em_dia'
    WHEN (CURRENT_DATE - r.data_vencimento) BETWEEN 1 AND 15 THEN 'atraso_1_15'
    WHEN (CURRENT_DATE - r.data_vencimento) BETWEEN 16 AND 30 THEN 'atraso_16_30'
    WHEN (CURRENT_DATE - r.data_vencimento) BETWEEN 31 AND 60 THEN 'atraso_31_60'
    WHEN (CURRENT_DATE - r.data_vencimento) BETWEEN 61 AND 90 THEN 'atraso_61_90'
    WHEN (CURRENT_DATE - r.data_vencimento) > 90 THEN 'atraso_mais_90'
    ELSE 'indefinido'
  END AS faixa_aging
FROM erp_receber r
LEFT JOIN companies c ON c.id = r.company_id
WHERE r.status <> 'cancelado';
