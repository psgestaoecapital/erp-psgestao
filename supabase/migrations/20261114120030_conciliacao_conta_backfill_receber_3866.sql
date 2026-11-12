-- Chamado #3866 (AJUSTE) — títulos a receber marcados como conciliados sem conta bancária.
-- Constatado na Troian (d577602d-...) e na Gean (a462e13f-...). Autorizado p/ todas pela Jordana.
--
-- O QUE ACONTECE: há erp_receber com conciliado=true e conta_bancaria_id IS NULL. A conta do
-- dinheiro está no lote da conciliação (conciliacao_lote.conta_bancaria_id), alcançável pelo
-- movimento vinculado (erp_receber.movimento_banco_id -> conciliacao_movimento.lote_id).
--
-- Esta migration faz o BACKFILL: preenche conta_bancaria_id dos títulos conciliados que estão
-- sem conta, copiando a conta do lote da conciliação. Só mexe em linhas com conta NULL (nunca
-- sobrescreve conta já informada) e só quando o lote tem conta bancária (lotes de CARTÃO, sem
-- conta bancária, ficam de fora — ali o dinheiro entra pelo repasse da operadora). Idempotente:
-- ao rodar de novo não há mais NULL resolvível, afeta 0 linhas.
--
-- Prova no dado (RD-38), 10/11/2026:
--   conciliado=true AND conta_bancaria_id IS NULL AND deleted_at IS NULL -> 122 títulos.
--   Resolvendo a conta pelo lote: 120 têm conta bancária; 2 são de lote de cartão (sem conta) -> ficam.
--   Depois do backfill: restam só os 2 de cartão sem conta; nenhum título bancário conciliado fica sem conta.
--
-- NÃO cria valor, não mexe em baixa, status, valor_pago nem conciliado — só a coluna conta_bancaria_id.

UPDATE public.erp_receber r
   SET conta_bancaria_id = l.conta_bancaria_id,
       updated_at = now()
  FROM public.conciliacao_movimento m
  JOIN public.conciliacao_lote l ON l.id = m.lote_id
 WHERE r.movimento_banco_id = m.id
   AND r.conciliado = true
   AND r.conta_bancaria_id IS NULL
   AND r.deleted_at IS NULL
   AND l.conta_bancaria_id IS NOT NULL
   AND l.company_id = r.company_id;   -- defensivo: lote e título da mesma empresa
