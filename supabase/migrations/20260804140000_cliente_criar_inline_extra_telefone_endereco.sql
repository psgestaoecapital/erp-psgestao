-- RD-26 · estende o criador INLINE de cliente da GE (fronteira GE: único ponto de escrita em
-- erp_clientes pela recepção — nada de INSERT direto no front). Additivo: aceita telefone + endereço
-- (enriquecimento CNPJ) via p_extra jsonb, pra NÃO descartar em silêncio o que o operador vê (RD-38).
-- Mantém o contrato antigo: o chamador de 3 args (agro/rebanho) resolve pra esta versão (p_extra default).
DROP FUNCTION IF EXISTS public.fn_cliente_criar_inline(uuid, text, text);

CREATE OR REPLACE FUNCTION public.fn_cliente_criar_inline(
  p_company_id uuid, p_nome text, p_cpf_cnpj text DEFAULT NULL, p_extra jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id  uuid;
  v_doc text := NULLIF(regexp_replace(COALESCE(p_cpf_cnpj,''), '\D', '', 'g'), '');
  v_tp  text := CASE WHEN v_doc IS NOT NULL AND length(v_doc) = 14 THEN 'PJ'
                     WHEN v_doc IS NOT NULL AND length(v_doc) = 11 THEN 'PF' END;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids())) THEN RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;
  IF COALESCE(trim(p_nome), '') = '' THEN RAISE EXCEPTION 'Nome do cliente obrigatorio'; END IF;

  INSERT INTO erp_clientes (
    company_id, nome_fantasia, razao_social, cpf_cnpj, cnpj_cpf, tipo_pessoa, ativo,
    telefone, email, logradouro, numero, bairro, cidade, uf, cep, codigo_ibge_municipio
  ) VALUES (
    p_company_id, trim(p_nome), trim(p_nome),
    NULLIF(trim(p_cpf_cnpj), ''), NULLIF(trim(p_cpf_cnpj), ''), v_tp, true,
    NULLIF(trim(COALESCE(p_extra->>'telefone', '')), ''),
    NULLIF(trim(COALESCE(p_extra->>'email', '')), ''),
    NULLIF(trim(COALESCE(p_extra->>'logradouro', '')), ''),
    NULLIF(trim(COALESCE(p_extra->>'numero', '')), ''),
    NULLIF(trim(COALESCE(p_extra->>'bairro', '')), ''),
    NULLIF(trim(COALESCE(p_extra->>'cidade', '')), ''),
    NULLIF(trim(COALESCE(p_extra->>'uf', '')), ''),
    NULLIF(trim(COALESCE(p_extra->>'cep', '')), ''),
    NULLIF(trim(COALESCE(p_extra->>'ibge', '')), '')
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_cliente_criar_inline(uuid, text, text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
