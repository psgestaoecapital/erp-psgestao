-- Liquidacao de boleto (idempotente) — chamada pelo polling do banco
-- ou pelo webhook de conciliacao. Localiza o titulo pelo nosso_numero
-- dentro da empresa, delega a baixa para fn_receber_baixar_pagamento
-- (fonte unica do status pago/parcial + fluxo) e carimba os campos
-- de boleto. Se receber payload cru do provider em p_provider_raw,
-- registra em erp_banco_sync_log (auditoria).
-- Aplicada via MCP em 2026-06-30.
--
-- Ajustes vs SPEC original:
--  - ambiente = 'producao' (valor real no schema; nao 'prod').
--  - INSERT em erp_banco_sync_log dentro de BEGIN/EXCEPTION NULL pra
--    nao derrubar a liquidacao se o log falhar.

CREATE OR REPLACE FUNCTION public.fn_boleto_liquidar(
  p_company_id     uuid,
  p_nosso_numero   text,
  p_data_pagamento date,
  p_valor_pago     numeric DEFAULT NULL,
  p_provider_raw   jsonb   DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_receber  record;
  v_conta_id uuid;
  v_baixa    jsonb;
BEGIN
  SELECT id, status, valor, boleto_status
    INTO v_receber
  FROM erp_receber
  WHERE company_id = p_company_id
    AND boleto_nosso_numero = p_nosso_numero
  ORDER BY boleto_emitido_em DESC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'recebivel_nao_encontrado',
                              'nosso_numero', p_nosso_numero);
  END IF;

  IF v_receber.boleto_status = 'liquidado' OR v_receber.status = 'pago' THEN
    RETURN jsonb_build_object('sucesso', true, 'ja_liquidado', true,
                              'receber_id', v_receber.id);
  END IF;

  SELECT banco_conta_id INTO v_conta_id
  FROM erp_banco_provider_config
  WHERE company_id = p_company_id AND provider = 'sicoob'
    AND ambiente = 'producao' AND ativo = true
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;

  v_baixa := public.fn_receber_baixar_pagamento(
    p_receber_id        := v_receber.id,
    p_data_pagamento    := p_data_pagamento,
    p_conta_bancaria_id := v_conta_id,
    p_forma_pagamento   := 'BOLETO',
    p_valor_pago        := COALESCE(p_valor_pago, v_receber.valor)
  );

  IF COALESCE((v_baixa->>'sucesso')::boolean, false) = false THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'falha_baixa',
                              'detalhe', v_baixa, 'receber_id', v_receber.id);
  END IF;

  UPDATE erp_receber
     SET boleto_status  = 'liquidado',
         boleto_pago_em = NOW()
   WHERE id = v_receber.id;

  IF p_provider_raw <> '{}'::jsonb THEN
    BEGIN
      INSERT INTO public.erp_banco_sync_log
        (company_id, banco_codigo, provider, tipo, status, qtd, mensagem, payload_resumo)
      VALUES
        (p_company_id, '756', 'sicoob', 'boleto_liquidar', 'ok', 1,
         format('nu=%s pago em %s', p_nosso_numero, p_data_pagamento),
         p_provider_raw);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'receber_id', v_receber.id,
                            'nosso_numero', p_nosso_numero, 'baixa', v_baixa);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_boleto_liquidar(uuid,text,date,numeric,jsonb)
  TO authenticated, service_role;
