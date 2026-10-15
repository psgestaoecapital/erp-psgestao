-- AUDITORIA GOLD FASE 1 · cron hierárquico (4 jobs) — NEUTRALIZADA (13/10/2026)
--
-- Esta migration foi aplicada à mão via MCP em 25/05/2026 e o arquivo só entrou na main em 13/10
-- (#160). Sem a versão no ledger, o `supabase db push --include-all` tentou reaplicá-la e quebrou:
-- "could not find valid entry for job 'insight-auditor-4x-dia'" (os crons do Insight Auditor não
-- existem mais em produção; foram substituídos por outros auditores). O deploy-migrations ficou
-- vermelho e segurou toda PR com migration na fila.
--
-- Agora é idempotente e NÃO recria os 4 jobs (recriá-los religaria chamadas pagas de IA sem decisão
-- do CEO — RD-42). Só remove o cron antigo se ele ainda existir.
--
-- Guard pg_cron (14/10, corrigido): o banco de testes das vagas NÃO tem a extensão pg_cron, então o schema
-- `cron` não existe. Em PL/pgSQL a condição do IF é PLANEJADA inteira antes de executar, então um
-- `EXISTS (SELECT 1 FROM cron.job ...)` dentro do IF quebra o `supabase db push` no PLAN com
-- `relation "cron.job" does not exist` (42P01) MESMO protegido por `to_regclass` (o AND não faz curto-circuito
-- no plan). Por isso a referência a cron.job fica em SQL DINÂMICO (EXECUTE), planejado só em runtime e apenas
-- quando `to_regclass('cron.job')` não é NULL — provado em produção (schema inexistente: forma dinâmica passa,
-- forma estática lança 42P01). Em produção (com pg_cron) desagenda o cron antigo se existir; idêntico ao antes.
DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$ SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'insight-auditor-4x-dia' $q$;
  END IF;
END
$$;
