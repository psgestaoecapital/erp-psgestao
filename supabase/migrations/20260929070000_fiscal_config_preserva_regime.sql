-- Configuração Fiscal não apaga mais o regime da empresa (CEO 29/09 · FC Pisos é LUCRO REAL).
--
-- Causa provada no audit_log_global (companies b202b50f): a FC foi cadastrada em lucro_real (20/08) e voltou a
-- "regime_normal" em 08/09 e 23/09. fn_fiscal_salvar_config (tela Configurações › Fiscal) fazia
--   UPDATE companies SET regime_tributario = COALESCE(p_regime, regime_tributario)
-- e p_regime é o vocabulário da CONFIG fiscal (simples_nacional | simples_nacional_excesso | regime_normal | mei).
-- "regime_normal" cobre presumido E real — gravá-lo por cima de lucro_presumido/lucro_real apaga a informação.
--
-- Correção: se p_regime = 'regime_normal' e a empresa já está em lucro_presumido ou lucro_real, o cadastro da empresa
-- fica como está. Qualquer outro caso segue igual a antes (Simples/MEI continuam atualizando a empresa).
-- Só muda essa linha do UPDATE; o resto da função é o mesmo.

CREATE OR REPLACE FUNCTION public.fn_fiscal_salvar_config(p_company_id uuid, p_provider text, p_ambiente text DEFAULT 'producao'::text, p_municipio_ibge text DEFAULT NULL::text, p_inscricao_municipal text DEFAULT NULL::text, p_serie_nfse text DEFAULT NULL::text, p_proximo_numero integer DEFAULT NULL::integer, p_regime text DEFAULT 'simples_nacional'::text, p_opcao_sn integer DEFAULT NULL::integer, p_apuracao_sn integer DEFAULT NULL::integer, p_pct_trib numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_endpoint text;
  v_aderido boolean := false;
  v_id uuid;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'company_id obrigatorio');
  END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM user_companies WHERE user_id = auth.uid() AND company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a empresa');
  END IF;

  IF p_provider NOT IN ('gov_nfse_nacional', 'focusnfe') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Emissor inválido');
  END IF;
  IF p_ambiente NOT IN ('homologacao', 'producao') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Ambiente inválido');
  END IF;
  IF COALESCE(p_inscricao_municipal, '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Inscrição Municipal é obrigatória para NFS-e');
  END IF;

  IF p_provider = 'gov_nfse_nacional' THEN
    v_endpoint := CASE WHEN p_ambiente = 'producao'
                  THEN 'https://sefin.nfse.gov.br'
                  ELSE 'https://sefin.producaorestrita.nfse.gov.br/sefinnacional' END;
    BEGIN
      v_aderido := COALESCE(fn_gov_nfse_municipio_aderiu(p_municipio_ibge), false);
    EXCEPTION WHEN OTHERS THEN
      v_aderido := true;
    END;
  END IF;

  -- cadastro da empresa: "regime_normal" (config) não apaga lucro_presumido/lucro_real (empresa)
  UPDATE companies SET
    inscricao_municipal = p_inscricao_municipal,
    regime_tributario   = CASE
                            WHEN p_regime = 'regime_normal' AND regime_tributario IN ('lucro_presumido', 'lucro_real')
                              THEN regime_tributario
                            ELSE COALESCE(p_regime, regime_tributario)
                          END,
    updated_at = now()
  WHERE id = p_company_id;

  -- upsert da config ativa do provider
  SELECT id INTO v_id FROM erp_fiscal_provider_config
   WHERE company_id = p_company_id AND provider = p_provider AND ativo = true
   LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO erp_fiscal_provider_config (
      company_id, provider, ambiente, regime_tributario, serie_nfse_padrao, proxima_numeracao_nfse,
      gov_nfse_municipio_codigo, gov_nfse_municipio_aderido, gov_nfse_endpoint_base, gov_nfse_proximo_numero_dps,
      opcao_simples_nacional, regime_apuracao_sn, percentual_total_tributos_sn, ativo, criado_por
    ) VALUES (
      p_company_id, p_provider, p_ambiente, p_regime,
      COALESCE(p_serie_nfse, '900'), COALESCE(p_proximo_numero, 1),
      p_municipio_ibge, v_aderido, v_endpoint, COALESCE(p_proximo_numero, 1),
      p_opcao_sn, p_apuracao_sn, p_pct_trib, true, auth.uid()
    );
  ELSE
    UPDATE erp_fiscal_provider_config SET
      ambiente = p_ambiente,
      regime_tributario = p_regime,
      serie_nfse_padrao = COALESCE(p_serie_nfse, serie_nfse_padrao),
      proxima_numeracao_nfse = COALESCE(p_proximo_numero, proxima_numeracao_nfse),
      gov_nfse_municipio_codigo = COALESCE(p_municipio_ibge, gov_nfse_municipio_codigo),
      gov_nfse_municipio_aderido = v_aderido,
      gov_nfse_endpoint_base = v_endpoint,
      gov_nfse_proximo_numero_dps = COALESCE(p_proximo_numero, gov_nfse_proximo_numero_dps),
      opcao_simples_nacional = COALESCE(p_opcao_sn, opcao_simples_nacional),
      regime_apuracao_sn = COALESCE(p_apuracao_sn, regime_apuracao_sn),
      percentual_total_tributos_sn = COALESCE(p_pct_trib, percentual_total_tributos_sn),
      atualizado_em = now(),
      atualizado_por = auth.uid()
    WHERE id = v_id;
  END IF;

  RETURN fn_fiscal_config_checklist(p_company_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_fiscal_salvar_config(uuid, text, text, text, text, text, integer, text, integer, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_salvar_config(uuid, text, text, text, text, text, integer, text, integer, integer, numeric) TO authenticated, service_role;
