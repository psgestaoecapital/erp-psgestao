-- RD-54 TIER 1 · imutabilidade dos logs de auditoria + trava de DELETE em dado real irrecuperável
-- ============================================================================
-- RD-54 aplicada à própria trava: ANTES deste ALTER, verifiquei no código que NENHUM
-- fluxo legítimo faz DELETE/UPDATE nessas tabelas (grep .delete()/DELETE FROM / .update()):
--   • erp_lancamento_log / audit_log_global → 0 mutação (são append-only por natureza)
--   • erp_nfse_emitidas → só 1 DELETE de limpeza histórica (migração one-off), não app; cancelar = UPDATE status
--   • erp_nfe_recebidas → só os FILHOS (_itens/_duplicatas) são deletados no re-apply; o PAI nunca
--   • erp_pec_animal / erp_pec_movimentacao / compliance_funcionarios → 0 DELETE (usam soft-delete via ativo)
-- Só cria triggers/funções — não toca dado. Sem UPDATE/DELETE de linha (RD-54).
-- ============================================================================

-- ── Ordem 1 · LOGS DE AUDITORIA = IMUTÁVEIS (só INSERT; nunca UPDATE/DELETE, SEM escape) ──
-- Auditoria que pode ser apagada não é auditoria: apaga o título e depois apaga o registro de que apagou = crime perfeito.
CREATE OR REPLACE FUNCTION fn_bloqueia_mutacao_auditoria()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Log de auditoria é IMUTÁVEL (append-only): % em % não é permitido.', TG_OP, TG_TABLE_NAME
    USING HINT = 'RD-54: todo log de auditoria só aceita INSERT. Nunca UPDATE, nunca DELETE.';
END $$;

DROP TRIGGER IF EXISTS trg_imutavel_erp_lancamento_log ON erp_lancamento_log;
CREATE TRIGGER trg_imutavel_erp_lancamento_log
  BEFORE UPDATE OR DELETE ON erp_lancamento_log
  FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_mutacao_auditoria();

DROP TRIGGER IF EXISTS trg_imutavel_audit_log_global ON audit_log_global;
CREATE TRIGGER trg_imutavel_audit_log_global
  BEFORE UPDATE OR DELETE ON audit_log_global
  FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_mutacao_auditoria();

-- ── Ordem 2-4 · DADO REAL IRRECUPERÁVEL · trava de DELETE físico (fn_bloqueia_delete_fisico, de #643) ──
-- Fiscal (NF autorizada na prefeitura — cancelar != deletar)
DROP TRIGGER IF EXISTS trg_bloqueia_delete_fisico ON erp_nfse_emitidas;
CREATE TRIGGER trg_bloqueia_delete_fisico BEFORE DELETE ON erp_nfse_emitidas
  FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_delete_fisico();

DROP TRIGGER IF EXISTS trg_bloqueia_delete_fisico ON erp_nfe_recebidas;
CREATE TRIGGER trg_bloqueia_delete_fisico BEFORE DELETE ON erp_nfe_recebidas
  FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_delete_fisico();

-- Agro (inventário do cliente · Estância)
DROP TRIGGER IF EXISTS trg_bloqueia_delete_fisico ON erp_pec_animal;
CREATE TRIGGER trg_bloqueia_delete_fisico BEFORE DELETE ON erp_pec_animal
  FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_delete_fisico();

DROP TRIGGER IF EXISTS trg_bloqueia_delete_fisico ON erp_pec_movimentacao;
CREATE TRIGGER trg_bloqueia_delete_fisico BEFORE DELETE ON erp_pec_movimentacao
  FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_delete_fisico();

-- Compliance (CPF + salário · LGPD)
DROP TRIGGER IF EXISTS trg_bloqueia_delete_fisico ON compliance_funcionarios;
CREATE TRIGGER trg_bloqueia_delete_fisico BEFORE DELETE ON compliance_funcionarios
  FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_delete_fisico();
