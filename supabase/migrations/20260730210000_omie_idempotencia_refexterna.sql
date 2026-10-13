-- BUG CRÍTICO (catch-up OMIE · idempotência incompleta) — diagnóstico Eng Chefe.
-- Depois de isentar a trava lógica (20260730180000), o próximo bloqueio surgiu:
-- duplicate key em uq_erp_pagar_ref_externa. O ETL do cron (fn_etl_omie_empresa)
-- fazia o UPSERT do PAGAR por ON CONFLICT (company_id, import_hash) — quando o
-- hash mudava no re-import, tentava INSERT e batia no índice único de ref_externa
-- (o ID do OMIE) → abortava. A chave de idempotência correta é
-- (company_id, ref_externa_sistema, ref_externa_id) — o codigo_lancamento do OMIE
-- — que o ETL do RECEBER já usava. Aplicada via MCP · RD-41.
--
-- (1) PAGAR: ON CONFLICT (import_hash) → ON CONFLICT (ref_externa). Re-import do
--     mesmo título ATUALIZA; título novo INSERE; lote nunca aborta por duplicata.
--     (feito com pg_get_functiondef + replace pra não re-transcrever a função.)
-- (2) Índices sobrepostos: erp_pagar/receber tinham DOIS índices únicos idênticos
--     nos mesmos 3 campos (um FULL constraint + um PARCIAL). Mantidos os PARCIAIS
--     (uq_*_ref_externa, os árbitros do ON CONFLICT); dropadas as CONSTRAINTs FULL
--     redundantes.
-- (3) 3ª trava: uk_*_import_hash — não pode coexistir 2 árbitros de ON CONFLICT e,
--     superada por ref_externa, poderia bloquear títulos distintos com mesmo hash.
--     Dropada (verificado: 0 duplicatas de hash e de ref_externa antes de dropar).
--
-- Prova (rollback): re-INSERT do mesmo ref_externa → qtd_antes=qtd_depois=1
--     (upsert atualizou, não duplicou · RD-54).

-- (1) troca cirúrgica do ON CONFLICT do PAGAR (import_hash → ref_externa)
DO $$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.fn_etl_omie_empresa(uuid)'::regprocedure);
  v_new := replace(v_def,
    'ON CONFLICT (company_id, import_hash) WHERE import_hash IS NOT NULL',
    'ON CONFLICT (company_id, ref_externa_sistema, ref_externa_id) WHERE ref_externa_id IS NOT NULL');
  IF v_new = v_def THEN
    RAISE NOTICE 'ON CONFLICT do pagar já migrado (ou não encontrado) — seguindo';
  ELSE
    EXECUTE v_new;
  END IF;
END $$;

-- (2) dropar as CONSTRAINTs FULL redundantes (mantém os índices PARCIAIS uq_*)
ALTER TABLE public.erp_pagar   DROP CONSTRAINT IF EXISTS erp_pagar_ref_externa_unq;
ALTER TABLE public.erp_receber DROP CONSTRAINT IF EXISTS erp_receber_ref_externa_unq;

-- (3) dropar os índices de import_hash (superados por ref_externa)
DROP INDEX IF EXISTS public.uk_erp_pagar_import_hash;
DROP INDEX IF EXISTS public.uk_erp_receber_import_hash;
