-- Auditoria CEO 20/11 (Hub Projetos, DEMO Construtora …006), item 6: a obra "ORBA TESTE"
-- (OBR-2026-0002) é lixo de teste e polui a DEMO. Arquiva (soft-delete) SÓ na DEMO 006,
-- presa ao id + número + company_id. Aditiva (soft-delete), idempotente (WHERE deleted_at IS NULL),
-- nunca apaga fisicamente nem toca empresa real.
UPDATE public.projetos_obras
SET deleted_at   = now(),
    delete_motivo = 'Lixo de teste arquivado (auditoria CEO 20/11, só DEMO)'
WHERE id = 'f5bd22cb-8bea-4676-a7d3-687d874ba90b'
  AND company_id = 'b0700000-0000-4000-a000-000000000006'
  AND numero = 'OBR-2026-0002'
  AND deleted_at IS NULL;
