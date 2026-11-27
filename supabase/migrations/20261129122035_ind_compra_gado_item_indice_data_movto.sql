-- P0 — /dashboard/inteligencia/recepcao (Compra de animais) estava fora do ar:
-- fn_bi_compra_gado_painel estourava > 60 s (gateway caía) porque recalcula a série de 14 meses
-- de fn_ind_compra_gado_item, e essa função varria TODAS as ~63 mil linhas jsonb do domínio
-- compra_gado para descartar ~53 mil pelo COD_TIPO_MV/DATA_MOVTO/DESC_PRODUTO_EST.
--
-- CAUSA MEDIDA (RD-38, prova 27/11, authenticated · FRIOESTE):
--   ind_atak_fato dominio='compra_gado' = 63.154 linhas; apenas 10.223 têm COD_TIPO_MV
--   em (T231,T234,T255) (as únicas que a função usa) e TODAS estão nos últimos 14 meses
--   (DATA_MOVTO 2025-08-04 .. 2026-11-27). O índice existente idx_ind_atak_fato_prod_data
--   é (company_id, dominio, DATA_ESTOQUE, COD_PRODUTO): para compra_gado (que filtra por
--   DATA_MOVTO, não DATA_ESTOQUE) só o prefixo (company_id, dominio) servia → heap scan de 63 mil.
--
-- CORREÇÃO (ADITIVA, só índice — zero mudança de função/comportamento/dado):
--   índice parcial casado com o filtro EXATO da fn_ind_compra_gado_item (dominio compra_gado +
--   COD_TIPO_MV relevante), ordenado por (company_id, DATA_MOVTO) para a faixa de datas do painel.
--   PROVA do plano (BEGIN…ROLLBACK, EXPLAIN sem ANALYZE): com o índice o planner troca o
--   "Seq/heap scan 63k" por "Index Scan ... Index Cond: company_id=X AND DATA_MOVTO >= .. AND < .."
--   lendo só as ~10 mil linhas relevantes. Atende a meta de tempo do painel sem tocar na lógica
--   (a regra do T255/MV tipada segue como evolução separada).
--
-- DATA_MOVTO é texto 'YYYY-MM-DD...' e a função compara como texto (>= / <), por isso o índice
-- é sobre a expressão de texto (raw->>'DATA_MOVTO') — imutável, elegível para índice.
-- Idempotente (IF NOT EXISTS). Não altera RLS nem dado de cliente.

CREATE INDEX IF NOT EXISTS idx_ind_atak_compra_gado_item
  ON public.ind_atak_fato (company_id, (raw->>'DATA_MOVTO'))
  WHERE dominio = 'compra_gado'
    AND raw->>'COD_TIPO_MV' IN ('T231', 'T234', 'T255');

COMMENT ON INDEX public.idx_ind_atak_compra_gado_item IS
  'Hot path de fn_ind_compra_gado_item / fn_bi_compra_gado_painel: parcial por dominio compra_gado + COD_TIPO_MV (T231/T234/T255), ordenado por DATA_MOVTO. Evita o heap scan das 63k linhas. P0 27/11.';
