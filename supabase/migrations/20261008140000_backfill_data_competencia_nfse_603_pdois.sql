-- Backfill pontual (decidido pelo Eng. Chefe 08/10): NFS-e nº 603 da Pdois saiu com data_competencia vazia.
-- 1 linha, competência = data da emissão em Brasília. Idempotente: só preenche se estiver vazia.
DO $$
DECLARE n int;
BEGIN
  UPDATE public.erp_nfse_emitidas
     SET data_competencia = (data_emissao AT TIME ZONE 'America/Sao_Paulo')::date
   WHERE id = 'ddfe9b1f-d798-4cef-87dd-112838fd5faf'
     AND numero::text = '603'
     AND company_id = '36b69d77-b4ea-414b-8519-2ff6621c8de7'
     AND data_competencia IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'backfill NFS-e 603: % linha(s) atualizada(s)', n;
END $$;
