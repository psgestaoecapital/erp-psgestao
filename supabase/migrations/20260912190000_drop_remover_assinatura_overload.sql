-- ============================================================
-- Onda 7 · dívida técnica — remover o overload ANTIGO de fn_os_remover_assinatura
-- ============================================================
-- Mesmo mecanismo do #1412: p_tipo entrou via CREATE OR REPLACE e criou um 2º overload.
--   (uuid)       → ANTIGO: limpa a assinatura legada em erp_os (assinatura_cliente = NULL)
--   (uuid,text)  → NOVO: remove por tipo (DELETE em erp_os_assinatura WHERE tipo=...); p_tipo NULL limpa a legada
-- Nenhum chamador do overload antigo (nem de nenhum): front/DB/edge sem referência. Dropar o antigo evita
-- que uma remoção futura de 1 arg limpe a coluna legada em vez do registro tipado.
-- RD-61: erp_os_assinatura intacta.

DROP FUNCTION IF EXISTS public.fn_os_remover_assinatura(uuid);
