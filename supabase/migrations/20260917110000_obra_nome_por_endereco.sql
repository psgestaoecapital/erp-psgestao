-- #53 (Rodrigo/R.R) — obra criada rápido herdava o NOME DO CLIENTE, gerando homônimos: a R.R
-- tinha 5 obras todas "Rodrigo Jantsch" (o nome do cliente), impossíveis de distinguir no seletor
-- de emissão de NFS-e (foi o que travou o Rodrigo no #82). Causa: fn_hub_criar_obra_rapida, sem
-- p_nome, caía no p_cliente_nome.
--
-- Correção: quando não há nome explícito, o nome da obra passa a ser o ENDEREÇO (logradouro nº —
-- cidade/UF), que é a identificação da origem e distingue uma obra da outra. Só cai no cliente/
-- 'Obra' quando não há endereço nenhum. Fix na origem: vale para TODOS os caminhos (venda, emissão,
-- correção) que chamam esta função.

CREATE OR REPLACE FUNCTION public.fn_hub_criar_obra_rapida(p_company_id uuid, p_cliente_id uuid, p_cliente_nome text, p_nome text, p_logradouro text, p_numero text, p_bairro text, p_cidade text, p_uf text, p_cep text, p_codigo_ibge text, p_cno text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ano    text := to_char(current_date, 'YYYY');
  v_prefix text := 'OBR-' || v_ano || '-';
  v_max    int;
  v_id     uuid;
  v_nome_endereco text;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id obrigatório';
  END IF;

  SELECT COALESCE(MAX(CAST(SUBSTRING(numero FROM '\d+$') AS int)), 0) INTO v_max
  FROM public.projetos_obras
  WHERE company_id = p_company_id AND numero LIKE v_prefix || '%';

  -- #53 · nome pelo endereço (identificação da origem), quando não vier nome explícito.
  -- Ex.: "Rua Marques do Herval 3249 — São Miguel do Oeste/SC". Distingue obras do mesmo cliente.
  v_nome_endereco := NULLIF(TRIM(
    concat_ws(' ', NULLIF(TRIM(p_logradouro), ''), NULLIF(TRIM(p_numero), ''))
    || CASE WHEN NULLIF(TRIM(p_cidade), '') IS NOT NULL
            THEN ' — ' || TRIM(p_cidade) || COALESCE('/' || NULLIF(TRIM(p_uf), ''), '')
            ELSE '' END
  ), '');

  INSERT INTO public.projetos_obras(
    company_id, numero, nome, cliente_id, cliente_nome,
    endereco, numero_endereco, bairro, cidade, uf, cep, codigo_ibge_municipio, cno, status
  ) VALUES (
    p_company_id,
    v_prefix || LPAD((v_max + 1)::text, 4, '0'),
    COALESCE(NULLIF(TRIM(p_nome), ''), v_nome_endereco, NULLIF(TRIM(p_cliente_nome), ''), 'Obra'),
    p_cliente_id,
    p_cliente_nome,
    NULLIF(TRIM(p_logradouro), ''),
    NULLIF(TRIM(p_numero), ''),
    NULLIF(TRIM(p_bairro), ''),
    NULLIF(TRIM(p_cidade), ''),
    NULLIF(TRIM(p_uf), ''),
    NULLIF(TRIM(p_cep), ''),
    NULLIF(TRIM(p_codigo_ibge), ''),   -- IBGE nulo = NULL, nunca chutado
    NULLIF(TRIM(p_cno), ''),
    'em_andamento'
  ) RETURNING id INTO v_id;

  RETURN v_id;
END; $function$;
