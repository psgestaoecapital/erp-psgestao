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
-- Guard pg_cron (14/10): o banco de testes das vagas NÃO tem a extensão pg_cron, então o schema `cron`
-- não existe. Sem o `to_regclass`, o "SELECT 1 FROM cron.job" quebra o `supabase db push --include-all`
-- da vaga com `relation "cron.job" does not exist` (42P01) e aborta a aceitação de TODA PR com migration.
-- `to_regclass` devolve NULL (não lança) quando a relação/esquema não existe; em produção (com pg_cron) o
-- comportamento é idêntico ao anterior.
DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'insight-auditor-4x-dia') THEN
    PERFORM cron.unschedule('insight-auditor-4x-dia');
  END IF;
END
$$;
