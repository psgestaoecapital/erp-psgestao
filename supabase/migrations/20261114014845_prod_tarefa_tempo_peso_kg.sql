-- CUSTEIO POR KG — F2 (medição tempo × peso), fatia 1 (CEO 11/11, contexto 46b4527a, RD-102).
-- Produto final SEMPRE em KG, genérico (bovinos/suínos/aves/serraria). A medição de tempo
-- da tarefa (prod_tarefa_tempo) hoje grava só tempo × nº de peças (seg_por_peca). Para
-- custear por KG é preciso também o PESO (kg) da peça medida e o derivado segundos por kg.
--
-- Esta fatia é SÓ o modelo de dados (aditivo). A captura do peso na tela Tarefas/cronômetro
-- e a média por atividade×produto em prod_tempo_padrao vêm nas próximas fatias.
--
-- ADITIVA e segura (RD-94.1 c):
--   • peso_kg: numeric NULLABLE (medições antigas ficam sem peso — nada quebra);
--   • seg_por_kg: coluna GERADA (STORED) = tempo_seg / peso_kg quando peso_kg > 0, senão NULL
--     (não precisa de backfill nem de manutenção; acompanha tempo_seg/peso_kg).
-- A tabela já tem RLS por company_id (policy existente) e REVOKE anon — coluna nova herda a
-- segurança da tabela; nenhuma policy/grant é alterada. IDEMPOTENTE (IF NOT EXISTS). Sem toque
-- em dado de cliente.

ALTER TABLE public.prod_tarefa_tempo
  ADD COLUMN IF NOT EXISTS peso_kg numeric;

ALTER TABLE public.prod_tarefa_tempo
  ADD COLUMN IF NOT EXISTS seg_por_kg numeric
  GENERATED ALWAYS AS (CASE WHEN peso_kg > 0 THEN tempo_seg / peso_kg ELSE NULL END) STORED;

COMMENT ON COLUMN public.prod_tarefa_tempo.peso_kg IS
  'Peso (kg) da peça/lote medido nesta cronometragem. Base do custeio por KG (RD-102). Nullable: medições antigas ou por peça não informam.';
COMMENT ON COLUMN public.prod_tarefa_tempo.seg_por_kg IS
  'Segundos por kg desta medição = tempo_seg / peso_kg (gerado). NULL quando peso_kg não informado.';

-- Guard de sanidade do peso (aditivo; só rejeita valor negativo, aceita NULL e positivo).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prod_tarefa_tempo_peso_kg_nao_negativo'
  ) THEN
    ALTER TABLE public.prod_tarefa_tempo
      ADD CONSTRAINT prod_tarefa_tempo_peso_kg_nao_negativo
      CHECK (peso_kg IS NULL OR peso_kg >= 0);
  END IF;
END $$;
