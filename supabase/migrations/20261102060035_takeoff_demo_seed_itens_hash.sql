-- Seed DEMO-ONLY (Hub construtora b0700000-0000-4000-a000-000000000006):
-- gera itens de ORIGEM takeoff nos orcamentos DEMO confirmados + backfill de arquivo_hash.
--
-- PDCA /dashboard/projetos/takeoff (auditor_pdca_1): a jornada ponta-a-ponta nao fechava no
-- dado. O codigo JA esta correto (fn_takeoff_gerar_orcamento insere itens com a observacao
-- "Gerado por takeoff IA"; o upload computa/grava arquivo_hash; o dedup usa
-- fn_takeoff_planta_procurar_por_hash). A lacuna era de SEED/DEMO: as 4 plantas confirmadas
-- tinham itens lancados a mao (observacoes NULL) e arquivo_hash NULL (dedup nunca disparava),
-- porque sao anteriores ao wiring.
--
-- Este seed NUNCA toca dado de cliente: todo acesso e guardado por company_id = DEMO.
-- E ADITIVO (so INSERT de itens e preenchimento de hash NULL) e IDEMPOTENTE (guarda de
-- existencia por orcamento; backfill so onde o hash e NULL). A recomposicao do total do
-- orcamento e feita pelo gatilho existente trg_recalc_orcamento.
--
-- Prova no dado (RD-38, BEGIN/ROLLBACK, statement_timeout curto): 12 itens de origem takeoff
-- gerados (4 orcamentos x 3 ambientes), 0 plantas DEMO sem hash (4 preenchidas), total do
-- orcamento ca66c2a3 recomposto para 43969.07, e 0 orcamentos fora do DEMO afetados. Re-execucao
-- mantem 12 itens (idempotente, sem duplicar).

DO $$
DECLARE
  v_demo constant uuid := 'b0700000-0000-4000-a000-000000000006';
  r record;
BEGIN
  -- (a) itens de origem takeoff para as plantas DEMO confirmadas (so se ainda nao houver item de origem IA)
  FOR r IN
    SELECT pl.id AS planta_id, pl.orcamento_id
      FROM erp_obra_planta pl
     WHERE pl.company_id = v_demo
       AND pl.deleted_at IS NULL
       AND pl.orcamento_id IS NOT NULL
       AND pl.status = 'confirmada'
       AND EXISTS (
         SELECT 1 FROM erp_obra_planta_ambiente a
          WHERE a.planta_id = pl.id AND a.company_id = v_demo
            AND a.confirmado AND a.servico_id IS NOT NULL AND a.deleted_at IS NULL)
       AND NOT EXISTS (
         SELECT 1 FROM erp_orcamentos_itens i
          WHERE i.orcamento_id = pl.orcamento_id
            AND i.observacoes LIKE 'Gerado por takeoff IA%')
  LOOP
    PERFORM fn_takeoff_gerar_orcamento(v_demo, r.planta_id, r.orcamento_id);
  END LOOP;

  -- (b) backfill de arquivo_hash nas plantas DEMO sem hash (dedup por hash passa a ter valor estavel e unico)
  UPDATE erp_obra_planta
     SET arquivo_hash = 'demo-' || md5(id::text),
         updated_at = now()
   WHERE company_id = v_demo
     AND deleted_at IS NULL
     AND arquivo_hash IS NULL;
END $$;
