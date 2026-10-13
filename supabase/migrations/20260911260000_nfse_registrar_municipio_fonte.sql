-- ============================================================
-- #32 (③) · fn_registrar_nfse_emitida passa a mapear município de prestação + fonte da alíquota
-- ============================================================
-- A tabela erp_nfse_emitidas JÁ tem as colunas municipio_prestacao_ibge/_nome/_uf e iss_fonte_aliquota
-- (Pilar 1 · "qual alíquota e de onde veio"), mas a função de registro não as gravava — o que a emissão
-- mandasse nesses campos era descartado. Esta migration é ADITIVA: adiciona só o mapeamento desses 4
-- campos a partir de p_dados. Chamadas atuais (que não enviam esses campos) seguem IDÊNTICAS — os campos
-- resolvem para NULL, exatamente como hoje.
--
-- iss_fonte_aliquota aceita 'cadastro' (veio de fiscal_iss_municipio) ou 'digitada' (o operador informou
-- na emissão e ela é oferecida para cadastro). 'provedor' nunca existirá: a Focus confirmou (09-11/09/2026)
-- que não há base oficial consolidada de alíquota/subitem LC116 por município no Brasil — a alíquota é nossa,
-- por cadastro/digitação. O código IBGE, esse sim, é resolvido localmente (erp_gov_nfse_municipios, 5.570
-- municípios) — nome→IBGE por autocomplete, sem chamada externa e sem custo por consulta (RD-42).
-- Não adiciono CHECK no valor da fonte aqui (evita quebrar linhas legadas); a emissão (③) é quem controla.

CREATE OR REPLACE FUNCTION public.fn_registrar_nfse_emitida(p_company_id uuid, p_erp_receber_id uuid, p_provider_reference text, p_ambiente text, p_dados jsonb, p_provider_raw jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.erp_nfse_emitidas (
    company_id, erp_receber_id, provider_reference, ambiente,
    valor_servicos, valor_iss, aliquota_iss, retem_iss,
    cnae, codigo_servico, descricao_servico,
    prestador_cnpj, prestador_razao_social, prestador_im,
    tomador_cnpj, tomador_cpf, tomador_razao_social, tomador_email, tomador_endereco,
    status, numero, serie, codigo_verificacao,
    xml_url, pdf_url, motivo_rejeicao,
    -- #32 (③) · aditivo: município de prestação + fonte da alíquota
    municipio_prestacao_ibge, municipio_prestacao_nome, municipio_prestacao_uf, iss_fonte_aliquota,
    provider_raw, emitido_por
  ) VALUES (
    p_company_id, p_erp_receber_id, p_provider_reference, p_ambiente,
    (p_dados->>'valor_servicos')::numeric,
    NULLIF(p_dados->>'valor_iss','')::numeric,
    NULLIF(p_dados->>'aliquota_iss','')::numeric,
    COALESCE((p_dados->>'retem_iss')::boolean, false),
    p_dados->>'cnae', p_dados->>'codigo_servico', p_dados->>'descricao_servico',
    p_dados->>'prestador_cnpj', p_dados->>'prestador_razao_social', p_dados->>'prestador_im',
    p_dados->>'tomador_cnpj', p_dados->>'tomador_cpf', p_dados->>'tomador_razao_social',
    p_dados->>'tomador_email', p_dados->'tomador_endereco',
    COALESCE(p_dados->>'status','processando'),
    p_dados->>'numero', p_dados->>'serie', p_dados->>'codigo_verificacao',
    p_dados->>'xml_url', p_dados->>'pdf_url', p_dados->>'motivo_rejeicao',
    -- #32 (③): NULLIF pra tratar string vazia como NULL (aditivo · sem esses campos = NULL, como hoje)
    NULLIF(p_dados->>'municipio_prestacao_ibge',''),
    NULLIF(p_dados->>'municipio_prestacao_nome',''),
    NULLIF(p_dados->>'municipio_prestacao_uf',''),
    NULLIF(p_dados->>'iss_fonte_aliquota',''),
    p_provider_raw, auth.uid()
  )
  RETURNING id INTO v_id;

  IF p_erp_receber_id IS NOT NULL THEN
    UPDATE public.erp_receber
    SET observacoes = COALESCE(observacoes, '') ||
        format(E'\nNFSe emitida em %s · ref %s', NOW()::date, p_provider_reference)
    WHERE id = p_erp_receber_id;
  END IF;

  RETURN v_id;
END;
$function$;
