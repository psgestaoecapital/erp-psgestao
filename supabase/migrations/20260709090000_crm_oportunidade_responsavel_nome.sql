-- Responsável como TEXTO LIVRE (decisão CEO): não precisa ser usuário do sistema.
-- Mantém responsavel_id (FK usuário, legado) e adiciona responsavel_nome (texto).
ALTER TABLE public.erp_crm_oportunidade ADD COLUMN IF NOT EXISTS responsavel_nome text;
