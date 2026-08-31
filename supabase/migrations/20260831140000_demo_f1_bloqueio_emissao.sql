-- DEMO-F1 §3 · Bloqueio de emissão/operação REAL em tenants não produtivos (demo/sandbox).
-- Cinto (banco): trigger defensivo. Suspensórios (frontend) ficam nas rotas de emissão.
-- Auditado (RD-38): erp_nfe_emitidas, erp_nfse_emitidas, erp_remessa_pagamento e
-- erp_banco_provider_config têm company_id. Boleto não tem tabela de "emitidas" própria
-- (é registrado via conector em erp_receber) → bloqueio de boleto fica na rota, não aqui.

CREATE OR REPLACE FUNCTION public.fn_bloqueia_emissao_nao_produtiva()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_amb text;
BEGIN
  SELECT ambiente_tenant INTO v_amb FROM public.companies WHERE id = NEW.company_id;
  IF v_amb IS DISTINCT FROM 'producao' THEN
    RAISE EXCEPTION
      'Operacao real bloqueada: esta empresa e de % (dados ficticios). Use uma empresa de producao.', COALESCE(v_amb,'ambiente desconhecido')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.fn_bloqueia_emissao_nao_produtiva IS
  'Trigger BEFORE INSERT: recusa emissao/operacao real quando companies.ambiente_tenant <> producao (demo/sandbox).';

-- NF-e
DROP TRIGGER IF EXISTS trg_bloqueia_emissao_demo ON public.erp_nfe_emitidas;
CREATE TRIGGER trg_bloqueia_emissao_demo
  BEFORE INSERT ON public.erp_nfe_emitidas
  FOR EACH ROW EXECUTE FUNCTION public.fn_bloqueia_emissao_nao_produtiva();

-- NFS-e
DROP TRIGGER IF EXISTS trg_bloqueia_emissao_demo ON public.erp_nfse_emitidas;
CREATE TRIGGER trg_bloqueia_emissao_demo
  BEFORE INSERT ON public.erp_nfse_emitidas
  FOR EACH ROW EXECUTE FUNCTION public.fn_bloqueia_emissao_nao_produtiva();

-- Remessa de pagamento (CNAB) — saída de dinheiro real
DROP TRIGGER IF EXISTS trg_bloqueia_emissao_demo ON public.erp_remessa_pagamento;
CREATE TRIGGER trg_bloqueia_emissao_demo
  BEFORE INSERT ON public.erp_remessa_pagamento
  FOR EACH ROW EXECUTE FUNCTION public.fn_bloqueia_emissao_nao_produtiva();

-- Conexão bancária: impedir cadastrar credencial de banco em tenant não produtivo
DROP TRIGGER IF EXISTS trg_bloqueia_conexao_banco_demo ON public.erp_banco_provider_config;
CREATE TRIGGER trg_bloqueia_conexao_banco_demo
  BEFORE INSERT ON public.erp_banco_provider_config
  FOR EACH ROW EXECUTE FUNCTION public.fn_bloqueia_emissao_nao_produtiva();
