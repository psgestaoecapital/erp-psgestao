-- Conciliação OFX: deduplicar por CONTEÚDO, não por FITID (chamado Troian, pedido rodrigo-chat 15/10).
-- Causa (provada na base): o Bradesco reaproveita FITIDs curtos ("N106B6"…) a cada exportação. Três índices ÚNICOS
-- sobre id_externo (company_id,id_externo / lote_id,id_externo ×2) faziam um extrato novo, com FITID repetido,
-- estourar duplicate key e o EXCEPTION de fn_conciliacao_criar_lote derrubar o lote inteiro (0 de N).
-- fn_conciliacao_criar_lote JÁ deduplica por conteúdo com contador de ocorrência (data + valor + descrição
-- normalizada: n no arquivo × n no banco), então dois PIX iguais no mesmo dia não são tratados como duplicata.
-- Falta só retirar a unicidade por FITID. id_externo vira dado informativo (índice comum, já existente:
-- idx_conciliacao_movimento_company_id_externo). Nenhum dado é alterado ou apagado; a função não muda.
DROP INDEX IF EXISTS public.uniq_conciliacao_movimento_company_idexterno;
DROP INDEX IF EXISTS public.uq_mov_lote_id_externo;
DROP INDEX IF EXISTS public.ux_conciliacao_movimento_idext;
CREATE INDEX IF NOT EXISTS idx_conciliacao_movimento_company_id_externo
  ON public.conciliacao_movimento (company_id, id_externo) WHERE id_externo IS NOT NULL;
