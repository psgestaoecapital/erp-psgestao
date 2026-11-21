-- Hub · auditoria CEO 20/11: a DEMO Construtora Modelo (006) tem a obra "ORBA TESTE" (OBR-2026-0002,
-- LEONARDO SOTT) — lixo de teste que polui o Cockpit de obras na demonstração. Arquivar SÓ na DEMO.
-- Arquivar = soft-delete (deleted_at) — RD-30: nada é apagado, o registro é preservado e reversível.
-- O Cockpit (/dashboard/projetos/cockpit) já filtra obras com deleted_at IS NOT NULL, então ela some da lista.
--
-- Segurança: só toca a DEMO (is_demo = true) e a obra EXATA (id + número + nome), idempotente
-- (deleted_at IS NULL → re-rodar é no-op). Nunca toca dado de cliente. RD-38: provado em BEGIN/ROLLBACK
-- que afeta exatamente 1 linha.
UPDATE public.projetos_obras o
   SET deleted_at = now()
 WHERE o.id = 'f5bd22cb-8bea-4676-a7d3-687d874ba90b'
   AND o.company_id = 'b0700000-0000-4000-a000-000000000006'
   AND o.numero = 'OBR-2026-0002'
   AND o.nome = 'ORBA TESTE'
   AND o.deleted_at IS NULL
   AND EXISTS (SELECT 1 FROM public.companies c WHERE c.id = o.company_id AND c.is_demo = true);
