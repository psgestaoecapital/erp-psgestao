-- RECONCILIAÇÃO DE LEDGER (Eng. Chefe 26/11): esta migration foi aplicada em produção FORA do repositório, via MCP
-- (apply_migration, 26/11 14:24 UTC), e travou o deploy-migrations ("Remote migration versions not found in local
-- migrations directory"). Conteúdo idêntico ao gravado no ledger; o db push não a reexecuta (versão já aplicada).
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.fn_boleto_liquidar'::regproc);
  IF position('conta_bancaria_id = COALESCE(conta_bancaria_id, v_conta_id)' in v_def) = 0 THEN
    v_def := replace(v_def,
      'UPDATE erp_receber SET boleto_status = ''liquidado'', boleto_pago_em = NOW() WHERE id = v_receber.id;',
      'UPDATE erp_receber SET boleto_status = ''liquidado'', boleto_pago_em = NOW(), conta_bancaria_id = COALESCE(conta_bancaria_id, v_conta_id) WHERE id = v_receber.id;');
    IF position('conta_bancaria_id = COALESCE(conta_bancaria_id, v_conta_id)' in v_def) = 0 THEN
      RAISE EXCEPTION 'trecho não encontrado';
    END IF;
    EXECUTE v_def;
  END IF;
END $$;
-- corrige boletos já liquidados que ficaram sem conta
UPDATE erp_receber r SET conta_bancaria_id = c.banco_conta_id
FROM erp_banco_provider_config c
WHERE c.company_id = r.company_id AND c.banco_codigo = r.boleto_banco_codigo AND c.ambiente='producao' AND c.ativo
  AND r.boleto_status='liquidado' AND r.conta_bancaria_id IS NULL AND r.deleted_at IS NULL AND r.status in ('pago','parcial')
  AND r.data_pagamento >= coalesce((select data_corte from erp_empresa_corte_historico h where h.company_id=r.company_id),'1900-01-01');
