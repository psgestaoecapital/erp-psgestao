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
-- COORDENAÇÃO COM A #3728 (data_fechamento) — correção do revisor (01/11):
-- fn_crm_oportunidade_ganhar() faz `data_fechamento = COALESCE(data_fechamento,
-- now()::date)` E `updated_at = now()`. Chamá-la num ganho histórico com
-- data_fechamento NULA carimbaria HOJE e distorceria os KPIs de desempenho
-- (Ganhas/Ticket/Comissão/Conversão/Velocidade por período). Para a ordem das
-- migrations deixar de importar, ESTE backfill primeiro grava a data coerente
-- (COALESCE(updated_at, created_at)) nos ganhos NULOS e só então cria as obras —
-- aí o COALESCE da função PRESERVA a data já coerente, nunca carimba hoje.
-- A #3728 continua idempotente (safety net; cobre também 'perdido').
--
-- Prova no dado (RD-38, 01/11, BEGIN/ROLLBACK em produção):
--   ganho = 28, nulos = 17, backfilláveis = 17, cairiam HOJE = 1 (ganho genuíno
--   de hoje). Datas coerentes: 2026-08-20 .. 2026-11-01. Ou seja, 16 dos 17
--   ficam com a data HISTÓRICA e apenas o 1 de hoje fica hoje — o que o carimbo
--   now() da função destruiria se rodasse antes desta data coerente.
--   antes ganhos_com_obra=3/28; depois do laço ganhos_com_obra=28/28.

-- 1) Data coerente ANTES de qualquer caminho que carimbe now() (torna a ordem
--    relativa à #3728 irrelevante — ambas convergem na data histórica).
UPDATE public.erp_crm_oportunidade
   SET data_fechamento = COALESCE(updated_at, created_at)::date
 WHERE etapa = 'ganho'
   AND data_fechamento IS NULL
   AND deleted_at IS NULL
   AND COALESCE(updated_at, created_at) IS NOT NULL;

-- 2) Cria a obra que faltava (a função preserva a data_fechamento já gravada).
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
