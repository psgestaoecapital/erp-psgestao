-- P0 · Config fiscal: auditoria + guarda anti-stub + 1-config-ativa (RD-52)
-- ============================================================================
-- Achado: 4 tenants foram apontados p/ provider=gov_nfse_nacional (STUB Fase 1,
-- nunca emitiu) SEM RASTRO — erp_fiscal_provider_config não tem updated_at nem
-- audit trigger. 2 em produção (PS, KGF) a uma nota de não faturar. Config fiscal
-- sem trilha de auditoria é como o DELETE físico: muda e ninguém sabe.
-- ============================================================================

-- 1) Trilha: updated_at + updated_by + auditoria (reusa fn_audit_log_trigger → audit_log_global)
ALTER TABLE erp_fiscal_provider_config
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid;

CREATE OR REPLACE FUNCTION fn_fiscal_cfg_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_touch_erp_fiscal_provider_config ON erp_fiscal_provider_config;
CREATE TRIGGER trg_touch_erp_fiscal_provider_config
  BEFORE INSERT OR UPDATE ON erp_fiscal_provider_config
  FOR EACH ROW EXECUTE FUNCTION fn_fiscal_cfg_touch();

DROP TRIGGER IF EXISTS trg_audit_erp_fiscal_provider_config ON erp_fiscal_provider_config;
CREATE TRIGGER trg_audit_erp_fiscal_provider_config
  AFTER INSERT OR UPDATE OR DELETE ON erp_fiscal_provider_config
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log_trigger();

-- 2) GUARDA anti-stub: BLOQUEIA (não alerta) ativar config p/ provider STUB.
-- gov_nfse_nacional é Fase 1 (não faz mTLS real; ninguém nunca emitiu por ele).
-- Apontar produção pra ele = armar a bomba. Quando sair de Fase 1, uma migração remove a guarda.
CREATE OR REPLACE FUNCTION fn_fiscal_cfg_bloqueia_stub()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ativo IS TRUE AND NEW.provider = 'gov_nfse_nacional' THEN
    RAISE EXCEPTION 'provider gov_nfse_nacional é STUB (Fase 1: não faz mTLS real / nunca emitiu). Não é permitido ATIVAR config fiscal apontando pra ele — a próxima nota cairia num caminho que nunca funcionou.'
      USING HINT = 'RD-52: config não pode apontar produção pra rota que nunca emitiu. Use focusnfe até o gov_nfse_nacional sair de Fase 1.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bloqueia_stub_fiscal ON erp_fiscal_provider_config;
CREATE TRIGGER trg_bloqueia_stub_fiscal
  BEFORE INSERT OR UPDATE ON erp_fiscal_provider_config
  FOR EACH ROW EXECUTE FUNCTION fn_fiscal_cfg_bloqueia_stub();

-- 3) 1 CONFIG ATIVA POR EMPRESA (mata a config-dupla que quebrava o .maybeSingle()).
-- A unique antiga (company_id, provider, ativo) permitia focus+ativo E gov+ativo juntos.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_uma_config_ativa
  ON erp_fiscal_provider_config(company_id) WHERE ativo;
