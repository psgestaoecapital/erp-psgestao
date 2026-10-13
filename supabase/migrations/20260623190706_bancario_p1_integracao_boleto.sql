-- ==========================================================
-- BANCARIO P1 — parametros de boleto + ponte conta + estado
-- Aditivo (RD-30). Nao dropa nada.
-- ==========================================================

-- 1) Colunas de parametros de boleto na config existente (aditivo)
ALTER TABLE public.erp_banco_provider_config
  ADD COLUMN IF NOT EXISTS juros_pct          numeric(6,3),
  ADD COLUMN IF NOT EXISTS multa_pct          numeric(6,3),
  ADD COLUMN IF NOT EXISTS dias_compensacao   integer,
  ADD COLUMN IF NOT EXISTS dias_protesto      integer,
  ADD COLUMN IF NOT EXISTS instrucao_linha1   text,
  ADD COLUMN IF NOT EXISTS instrucao_linha2   text,
  ADD COLUMN IF NOT EXISTS instrucao_linha3   text,
  ADD COLUMN IF NOT EXISTS instrucao_linha4   text,
  ADD COLUMN IF NOT EXISTS gerar_pix          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS banco_conta_id     uuid REFERENCES public.erp_banco_contas(id);

-- 2) RPC: ler ESTADO da integracao para a tela carregar (SEM expor segredos)
CREATE OR REPLACE FUNCTION public.fn_banco_integracao_estado(
  p_company_id  uuid,
  p_banco_codigo text,
  p_ambiente    text DEFAULT 'producao'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cfg record; v_tem_cert boolean;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem permissao para esta empresa';
  END IF;

  SELECT * INTO v_cfg FROM erp_banco_provider_config
   WHERE company_id = p_company_id AND banco_codigo = p_banco_codigo AND ambiente = p_ambiente;

  SELECT EXISTS(
    SELECT 1 FROM erp_certificados_a1
     WHERE company_id = p_company_id AND status = 'ativo'
       AND validade_fim::date >= CURRENT_DATE
  ) INTO v_tem_cert;

  RETURN jsonb_build_object(
    'existe',               v_cfg.id IS NOT NULL,
    'ambiente',             p_ambiente,
    'client_id',            v_cfg.client_id,
    'tem_client_secret',    v_cfg.client_secret_vault_id IS NOT NULL,
    'tem_certificado_a1',   v_tem_cert,
    'cap_boleto',           COALESCE(v_cfg.cap_boleto, false),
    'cap_extrato',          COALESCE(v_cfg.cap_extrato, false),
    'cap_pagamento',        COALESCE(v_cfg.cap_pagamento, false),
    'agencia',              v_cfg.agencia,
    'conta',                v_cfg.conta,
    'carteira',             v_cfg.carteira,
    'convenio',             v_cfg.convenio,
    'codigo_beneficiario',  v_cfg.codigo_beneficiario,
    'juros_pct',            v_cfg.juros_pct,
    'multa_pct',            v_cfg.multa_pct,
    'dias_compensacao',     v_cfg.dias_compensacao,
    'dias_protesto',        v_cfg.dias_protesto,
    'instrucao_linha1',     v_cfg.instrucao_linha1,
    'instrucao_linha2',     v_cfg.instrucao_linha2,
    'instrucao_linha3',     v_cfg.instrucao_linha3,
    'instrucao_linha4',     v_cfg.instrucao_linha4,
    'gerar_pix',            COALESCE(v_cfg.gerar_pix, false),
    'banco_conta_id',       v_cfg.banco_conta_id,
    -- "Integracao habilitada" = tem client_id + secret + cert A1 valido (igual mensagem do Omie)
    'integracao_habilitada',(v_cfg.client_id IS NOT NULL
                             AND v_cfg.client_secret_vault_id IS NOT NULL
                             AND v_tem_cert)
  );
END $$;

-- 3) RPC: salvar PARAMETROS DE BOLETO (juros/multa/instrucoes/pix + ponte conta)
CREATE OR REPLACE FUNCTION public.fn_banco_boleto_params_salvar(
  p_company_id      uuid,
  p_banco_codigo    text,
  p_ambiente        text,
  p_juros_pct       numeric DEFAULT NULL,
  p_multa_pct       numeric DEFAULT NULL,
  p_dias_compensacao integer DEFAULT NULL,
  p_dias_protesto   integer DEFAULT NULL,
  p_instrucao_linha1 text DEFAULT NULL,
  p_instrucao_linha2 text DEFAULT NULL,
  p_instrucao_linha3 text DEFAULT NULL,
  p_instrucao_linha4 text DEFAULT NULL,
  p_gerar_pix       boolean DEFAULT NULL,
  p_banco_conta_id  uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem permissao para esta empresa';
  END IF;

  UPDATE erp_banco_provider_config SET
    juros_pct        = COALESCE(p_juros_pct, juros_pct),
    multa_pct        = COALESCE(p_multa_pct, multa_pct),
    dias_compensacao = COALESCE(p_dias_compensacao, dias_compensacao),
    dias_protesto    = COALESCE(p_dias_protesto, dias_protesto),
    instrucao_linha1 = COALESCE(p_instrucao_linha1, instrucao_linha1),
    instrucao_linha2 = COALESCE(p_instrucao_linha2, instrucao_linha2),
    instrucao_linha3 = COALESCE(p_instrucao_linha3, instrucao_linha3),
    instrucao_linha4 = COALESCE(p_instrucao_linha4, instrucao_linha4),
    gerar_pix        = COALESCE(p_gerar_pix, gerar_pix),
    banco_conta_id   = COALESCE(p_banco_conta_id, banco_conta_id),
    updated_at       = now(),
    updated_by       = auth.uid()
  WHERE company_id = p_company_id AND banco_codigo = p_banco_codigo AND ambiente = p_ambiente
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Configure primeiro a aba Integracao API (credenciais) antes dos parametros de boleto';
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

GRANT EXECUTE ON FUNCTION public.fn_banco_integracao_estado(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_banco_boleto_params_salvar(uuid,text,text,numeric,numeric,integer,integer,text,text,text,text,boolean,uuid) TO authenticated;
