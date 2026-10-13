-- RD-41 · Base de estoque "estado da arte" — erp_produtos pronta pra contabilidade + todas as áreas.
-- Padrão SPED 0200 / NF-e (não exclusivo). ADITIVO PURO (RD-30/RD-54): só adiciona colunas + backfill de
-- um default seguro; não altera nada existente. Preparar ANTES de importar os 1.384 (base nasce certa).
-- conta_contabil_id fica como uuid solto (liga ao plano_contas existente na aplicação; sem FK rígida
-- pra não acoplar/quebrar com plano de contas company-scoped).
ALTER TABLE public.erp_produtos
  ADD COLUMN IF NOT EXISTS tipo_item_sped text,        -- SPED 0200 TIPO_ITEM: 00..10, 99
  ADD COLUMN IF NOT EXISTS conta_contabil_id uuid,     -- conta analítica (custeio/estoque) → plano_contas
  ADD COLUMN IF NOT EXISTS unidade_compra text,        -- ex.: CX (compra na embalagem)
  ADD COLUMN IF NOT EXISTS fator_conversao numeric DEFAULT 1,  -- un. de estoque por un. de compra (ex.: 1000)
  ADD COLUMN IF NOT EXISTS unidade_inventario text,    -- UNID_INV do SPED (default = unidade)
  ADD COLUMN IF NOT EXISTS controla_lote boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS controla_validade boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS cod_genero text,            -- COD_GEN (2 primeiros díg. do NCM)
  ADD COLUMN IF NOT EXISTS cod_lista_servico text,     -- COD_LST (LC 116/03)
  ADD COLUMN IF NOT EXISTS ex_ipi text;                -- EX_IPI (exceção da TIPI)

-- default seguro do inventário = unidade atual (só onde ainda está nulo)
UPDATE public.erp_produtos
   SET unidade_inventario = COALESCE(unidade_inventario, unidade)
 WHERE unidade_inventario IS NULL;
