-- FIX ATAK · vault_secret_name opcional (destrava "Salvar conexão").
-- Bug: salvar a conexão ATAK no modelo self-service (push) estourava
--   null value in column "vault_secret_name" of relation "atak_conexao_config" violates not-null constraint
-- Causa: no self-service a senha do SQL Server fica no .env da máquina do cliente — a senha NUNCA chega ao
-- nosso backend (Pilar 2), logo não existe segredo no nosso cofre e a coluna fica nula. vault_secret_name
-- NOT NULL é sobra do modelo antigo (pull/conexão direta).
-- RD-51: nulo é o valor honesto (não referenciar um segredo que não existe). Quem usar conexão direta
-- continua preenchendo vault_secret_name normalmente — a coluna existe, só deixa de ser obrigatória.
-- Sem mudança de frontend: o "Salvar conexão" já envia vault_secret_name nulo.
ALTER TABLE public.atak_conexao_config
  ALTER COLUMN vault_secret_name DROP NOT NULL;
