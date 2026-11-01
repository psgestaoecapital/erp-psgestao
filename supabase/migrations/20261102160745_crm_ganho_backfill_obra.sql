-- PDCA Hub · /dashboard/projetos/oportunidades (aud8 91/95)
-- GAP (RD-38): 25 de 28 oportunidades 'ganho' não tinham obra vinculada
-- (projetos_obras.oportunidade_id). A jornada ganhar→obra já funciona daqui pra
-- frente (fn_crm_oportunidade_ganhar cria a obra, idempotente), mas os ganhos
-- históricos ficaram sem obra. Este backfill fecha a jornada no histórico.
--
-- Aditiva: só CRIA a obra que faltava, reutilizando a função canônica (não
-- replica lógica de numeração). Idempotente em dois níveis: o guard NOT EXISTS
-- abaixo + a própria idempotência da função (devolve a obra existente sem criar
-- segunda). Reexecutar não duplica. Volume trivial (dezenas de linhas).
--
-- Prova (BEGIN/ROLLBACK em produção, 01/11): antes ganhos_com_obra=3/28;
-- depois do laço ganhos_com_obra=28/28.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT o.id
      FROM public.erp_crm_oportunidade o
     WHERE o.etapa = 'ganho'
       AND o.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.projetos_obras b
          WHERE b.company_id = o.company_id
            AND b.oportunidade_id = o.id
       )
  LOOP
    PERFORM public.fn_crm_oportunidade_ganhar(r.id);
  END LOOP;
END $$;
