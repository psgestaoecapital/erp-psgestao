-- ============================================================
-- Onda 7 · dívida técnica — remover o overload ANTIGO de fn_os_assinar
-- ============================================================
-- Mesmo mecanismo do #1412: p_tipo entrou via CREATE OR REPLACE e criou um 2º overload.
--   (uuid,text)       → ANTIGO: grava a assinatura legada em erp_os.assinatura_cliente (sem tipo)
--   (uuid,text,text)  → NOVO: grava em erp_os_assinatura por tipo (checklist_ciente/entrega); ON CONFLICT atualiza
-- Chamador único: AssinaturaModal.tsx já chama com p_tipo (novo). Nenhum caller de 2 args (front/DB/edge).
-- Dropar o antigo elimina o risco de uma chamada futura de 2 args cair nele e gravar "assinatura solta".
-- RD-61: erp_os_assinatura intacta (2 registros); erp_os.assinatura_cliente não é tocada.

DROP FUNCTION IF EXISTS public.fn_os_assinar(uuid, text);
