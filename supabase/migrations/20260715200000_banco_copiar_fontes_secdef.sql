-- Assistente Bancário · BLOCO 4 (copiar config) — conserto de RLS (SECURITY DEFINER)
-- ============================================================================
-- Achado (auditoria da Julia, ajuste fino #1): no assistente, ao escolher Sicoob
-- num tenant que PRECISA conectar (ex.: Proplay), o botão "copiar da PS Gestão"
-- NÃO aparecia. Causa raiz: fn_banco_fontes_copiaveis e fn_banco_copiar_config
-- rodavam sob a RLS do CHAMADOR (não eram SECURITY DEFINER). Um usuário do tenant
-- Proplay não enxerga a linha de erp_banco_provider_config da PS (RLS por empresa)
-- → a função-fonte devolvia vazio → o botão nunca renderizava. A cópia só
-- "funcionava" nos meus testes via MCP porque MCP roda como service_role (fura RLS).
--
-- Correção: as duas viram SECURITY DEFINER.
--   • fontes: devolve SÓ metadado de descoberta (empresa, provider, banco_codigo,
--     contagens de prova) — NENHUM segredo. É seguro um tenant ver "a PS já provou
--     este banco".
--   • copiar: como SECURITY DEFINER fura a RLS, TRAVAMOS o destino — o chamador só
--     copia PARA uma empresa que é dele (get_user_company_ids). A forma copiada
--     continua sem segredo (só banco_codigo/ambiente/caps/carteira/conta ligada).
-- RD-51: o que funciona tem que APARECER — fonte provada invisível é a UI mentindo
-- por omissão.
-- ============================================================================

-- 1) FONTES — descoberta cross-tenant de configs PROVADAS (sem segredo)
CREATE OR REPLACE FUNCTION public.fn_banco_fontes_copiaveis(p_provider text)
RETURNS TABLE(company_id uuid, empresa text, provider text, banco_codigo text, boletos integer, syncs_ok integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT f.company_id,
         coalesce(c.razao_social, c.nome_fantasia, left(f.company_id::text,8)),
         f.provider, f.banco_codigo,
         (SELECT count(*)::int FROM erp_receber r WHERE r.company_id=f.company_id AND r.boleto_banco_codigo=f.banco_codigo AND r.boleto_nosso_numero IS NOT NULL),
         (SELECT count(*)::int FROM erp_banco_sync_log s WHERE s.company_id=f.company_id AND lower(coalesce(s.status,''))='ok')
  FROM erp_banco_provider_config f
  LEFT JOIN companies c ON c.id=f.company_id
  WHERE f.provider = p_provider AND f.ativo = true
    AND ( EXISTS(SELECT 1 FROM erp_receber r WHERE r.company_id=f.company_id AND r.boleto_banco_codigo=f.banco_codigo AND r.boleto_nosso_numero IS NOT NULL)
       OR EXISTS(SELECT 1 FROM erp_banco_sync_log s WHERE s.company_id=f.company_id AND lower(coalesce(s.status,''))='ok') )
  GROUP BY f.company_id, c.razao_social, c.nome_fantasia, f.provider, f.banco_codigo;
$function$;

-- 2) COPIAR — SECURITY DEFINER + trava de destino (só copio PRA empresa minha)
CREATE OR REPLACE FUNCTION public.fn_banco_copiar_config(p_origem_company uuid, p_destino_company uuid, p_provider text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_src record; v_conta uuid; v_id uuid;
BEGIN
  -- Trava (SECURITY DEFINER fura RLS): destino TEM que ser empresa do chamador.
  -- Sem isto, qualquer autenticado plantaria config em empresa alheia.
  IF NOT (p_destino_company IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_ao_destino');
  END IF;
  IF p_origem_company = p_destino_company THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'origem e destino não podem ser a mesma empresa');
  END IF;
  SELECT * INTO v_src FROM erp_banco_provider_config
   WHERE company_id = p_origem_company AND provider = p_provider AND ativo = true
   ORDER BY (ambiente = 'producao') DESC LIMIT 1;
  IF v_src IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'config-fonte não encontrada ou inativa');
  END IF;
  SELECT id INTO v_conta FROM erp_banco_contas
   WHERE company_id = p_destino_company AND banco_codigo = v_src.banco_codigo
   ORDER BY ativo DESC NULLS LAST LIMIT 1;
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
    'ok', true, 'config_id', v_id,
    'copiado_a_forma', jsonb_build_object('banco_codigo', v_src.banco_codigo, 'ambiente', v_src.ambiente,
      'cap_boleto', v_src.cap_boleto, 'cap_extrato', v_src.cap_extrato, 'cap_pagamento', v_src.cap_pagamento,
      'carteira', v_src.carteira, 'banco_conta_id_ligado', (v_conta IS NOT NULL)),
    'operador_preenche', jsonb_build_array('cooperativa','conta','codigo_beneficiario/convenio','client_id','certificado(.pfx)/apikey'),
    'nunca_copiado_segredo', jsonb_build_array('cert','certpw','apikey','client_secret','webhook',
      'client_id','cooperativa','conta','codigo_beneficiario','convenio')
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_banco_fontes_copiaveis(text)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_banco_copiar_config(uuid, uuid, text) TO authenticated, service_role;
