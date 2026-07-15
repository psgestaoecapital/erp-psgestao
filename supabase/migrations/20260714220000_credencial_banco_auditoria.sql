-- P0 (RD-53) · Auditoria em erp_credencial + erp_banco_provider_config
-- ============================================================================
-- Pré-condição do Assistente de Conexão Bancária: o assistente GRAVA credenciais.
-- Gravar em tabela sem trilha histórica = repetir o flip fiscal (que aconteceu numa
-- tabela cega e ninguém soube). Credencial é PIOR — são as chaves do cofre.
--
-- Estado achado (RD-44): erp_credencial NÃO é totalmente cega — tem atualizado_em/
-- atualizado_por (updated_at/by em PT), revelado_ultima_vez_por/em e ativo (soft-delete).
-- MAS falta o AUDIT TRIGGER (histórico de→para em audit_log_global). erp_banco_provider_config
-- tem updated_at mas também não tem audit trigger. Fechamos os dois.
-- ============================================================================

-- Histórico de mudanças (I/U/D) → audit_log_global com valor_anterior/valor_novo
DROP TRIGGER IF EXISTS trg_audit_erp_credencial ON erp_credencial;
CREATE TRIGGER trg_audit_erp_credencial
  AFTER INSERT OR UPDATE OR DELETE ON erp_credencial
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log_trigger();

DROP TRIGGER IF EXISTS trg_audit_erp_banco_provider_config ON erp_banco_provider_config;
CREATE TRIGGER trg_audit_erp_banco_provider_config
  AFTER INSERT OR UPDATE OR DELETE ON erp_banco_provider_config
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log_trigger();
