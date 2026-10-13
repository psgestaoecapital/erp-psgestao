-- Assistente Bancário · BLOCO 4 · "Copiar configuração de outra empresa"
-- ============================================================================
-- De 12 campos → 3. Copia a FORMA (banco_codigo, ambiente, capabilities/scopes, carteira)
-- + auto-liga banco_conta_id à conta do DESTINO (fecha o gap 2.1: liquidação sem conta).
-- 🔒 NUNCA copia SEGREDO: cert/certpw/apikey/client_secret/webhook (ficam por-empresa no Vault).
-- 🔒 NUNCA copia dado de CONTA da fonte: cooperativa/conta/codigo_beneficiario/convenio/client_id
--    (são da empresa nova — o operador preenche esses 3).
-- 🔒 RD-53: só LÊ a config-fonte, NUNCA escreve nela.
-- Nasce ativo=false + estado_conexao='recebido' — o operador preenche os 3 campos, testa a escada, aí ativa.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_banco_copiar_config(
  p_origem_company uuid, p_destino_company uuid, p_provider text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_src record; v_conta uuid; v_id uuid;
BEGIN
  IF p_origem_company = p_destino_company THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'origem e destino não podem ser a mesma empresa');
  END IF;

  -- LÊ a config-fonte (preferindo produção). NUNCA escreve nela (RD-53).
  SELECT * INTO v_src FROM erp_banco_provider_config
   WHERE company_id = p_origem_company AND provider = p_provider AND ativo = true
   ORDER BY (ambiente = 'producao') DESC LIMIT 1;
  IF v_src IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'config-fonte não encontrada ou inativa');
  END IF;

  -- auto-liga à conta bancária do DESTINO com o mesmo banco (fecha o gap do banco_conta_id nulo)
  SELECT id INTO v_conta FROM erp_banco_contas
   WHERE company_id = p_destino_company AND banco_codigo = v_src.banco_codigo
   ORDER BY ativo DESC NULLS LAST LIMIT 1;

  -- cria a config do DESTINO copiando SÓ a FORMA (nasce inativa até o operador preencher+testar)
  INSERT INTO erp_banco_provider_config
    (company_id, provider, banco_codigo, ambiente,
     cap_boleto, cap_extrato, cap_pagamento, carteira,
     banco_conta_id, estado_conexao, ativo)
  VALUES
    (p_destino_company, p_provider, v_src.banco_codigo, v_src.ambiente,
     v_src.cap_boleto, v_src.cap_extrato, v_src.cap_pagamento, v_src.carteira,
     v_conta, 'recebido', false)
  ON CONFLICT (company_id, banco_codigo, ambiente) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'destino já tem config para este banco/ambiente');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'config_id', v_id,
    'copiado_a_forma', jsonb_build_object('banco_codigo', v_src.banco_codigo, 'ambiente', v_src.ambiente,
      'cap_boleto', v_src.cap_boleto, 'cap_extrato', v_src.cap_extrato, 'cap_pagamento', v_src.cap_pagamento,
      'carteira', v_src.carteira, 'banco_conta_id_ligado', (v_conta IS NOT NULL)),
    'operador_preenche', jsonb_build_array('cooperativa','conta','codigo_beneficiario/convenio','client_id','certificado(.pfx)/apikey'),
    'nunca_copiado_segredo', jsonb_build_array('cert','certpw','apikey','client_secret','webhook',
      'client_id','cooperativa','conta','codigo_beneficiario','convenio')
  );
END $$;

GRANT EXECUTE ON FUNCTION fn_banco_copiar_config(uuid, uuid, text) TO authenticated, service_role;

-- Fontes copiáveis (RD-51: só oferecer copiar de config PROVADA — com boleto/sync real, não fantasma)
CREATE OR REPLACE FUNCTION fn_banco_fontes_copiaveis(p_provider text)
RETURNS TABLE(company_id uuid, empresa text, provider text, banco_codigo text, boletos int, syncs_ok int)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT f.company_id,
         coalesce(c.razao_social, c.nome_fantasia, left(f.company_id::text,8)),
         f.provider, f.banco_codigo,
         (SELECT count(*)::int FROM erp_receber r WHERE r.company_id=f.company_id AND r.boleto_banco_codigo=f.banco_codigo AND r.boleto_nosso_numero IS NOT NULL),
         (SELECT count(*)::int FROM erp_banco_sync_log s WHERE s.company_id=f.company_id AND lower(coalesce(s.status,''))='ok')
  FROM erp_banco_provider_config f
  LEFT JOIN companies c ON c.id=f.company_id
  WHERE f.provider = p_provider AND f.ativo = true
    -- só fonte PROVADA: tem boleto real OU sync ok (nunca oferecer copiar de uma config que nunca funcionou)
    AND ( EXISTS(SELECT 1 FROM erp_receber r WHERE r.company_id=f.company_id AND r.boleto_banco_codigo=f.banco_codigo AND r.boleto_nosso_numero IS NOT NULL)
       OR EXISTS(SELECT 1 FROM erp_banco_sync_log s WHERE s.company_id=f.company_id AND lower(coalesce(s.status,''))='ok') )
  GROUP BY f.company_id, c.razao_social, c.nome_fantasia, f.provider, f.banco_codigo;
$$;

GRANT EXECUTE ON FUNCTION fn_banco_fontes_copiaveis(text) TO authenticated, service_role;
