-- conserto-main (RD-52) · reconciliação de órfão do ledger — deploy-migrations VERMELHO na main.
--
-- O ledger de produção (supabase_migrations.schema_migrations) tinha a versão 20261126142432
-- (name: boleto_liquidar_grava_conta_bancaria) SEM arquivo correspondente no repositório —
-- ela foi aplicada à mão em produção (carimbo de horário do apply_migration, 2026-11-26 14:24:32),
-- violando a RD-52. Com isso o `supabase db push --include-all` abortava com
-- "Remote migration versions not found in local migrations directory" e segurava TODAS as migrations.
--
-- Prova RD-38 (produção, 26/11): a versão existe no ledger com estes exatos statements; nenhum
-- arquivo em nenhum ref do repo os contém. O conteúdo JÁ está aplicado (a função fn_boleto_liquidar
-- já grava conta_bancaria_id e o backfill já rodou). Este arquivo apenas DOCUMENTA o que rodou,
-- com a MESMA versão do ledger, para o db push voltar a bater arquivo↔ledger (verde). Não há
-- escrita nova em produção: a versão já está marcada como aplicada, então o db push a ignora.
-- Ambos os passos são IDEMPOTENTES (guarda por position()=0 e por conta_bancaria_id IS NULL),
-- então um replay em banco de testes/novo reproduz fielmente o estado de produção sem duplicar efeito.
--
-- Origem a auditar (RD-52): algum Code aplicou esta migration de boleto via apply_migration/execute_sql
-- sem abrir o arquivo no PR. Alertado ao eng_chefe/CEO no handoff.

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
