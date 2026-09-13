-- ============================================================
-- Onda 0 (backend) · vincular cliente à OS (fila da GE) + DEDUP no criar-cliente-inline
-- ============================================================
-- Fila "Faturar OS": as 14 sem cliente_id não faturam (título solto não concilia). A GE vincula
-- o cliente antes. Dois cuidados do CEO:
--  1) DEDUP no criar inline (por documento e por nome normalizado, como fn_oficina_servico_criar) —
--     senão criar duplicata "na pressa" suja a base de cobrança;
--  2) PROPAGAR o cliente_id PARA A OS (não só o título) — senão a OS continua "sem cliente" na fila.

-- 1) criar-cliente-inline agora DEDUPLICA (por doc; senão por nome normalizado). Reusa o existente.
--    (compartilhada; devolver o id existente em vez de criar duplicata é melhor p/ todos os callers.)
CREATE OR REPLACE FUNCTION public.fn_cliente_criar_inline(p_company_id uuid, p_nome text, p_cpf_cnpj text DEFAULT NULL::text, p_extra jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id  uuid;
  v_doc text := NULLIF(regexp_replace(COALESCE(p_cpf_cnpj,''), '\D', '', 'g'), '');
  v_tp  text := CASE WHEN v_doc IS NOT NULL AND length(v_doc) = 14 THEN 'PJ'
                     WHEN v_doc IS NOT NULL AND length(v_doc) = 11 THEN 'PF' END;
  v_norm text := unaccent(lower(btrim(regexp_replace(COALESCE(p_nome,''), '\s+', ' ', 'g'))));
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids())) THEN RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;
  IF COALESCE(trim(p_nome), '') = '' THEN RAISE EXCEPTION 'Nome do cliente obrigatorio'; END IF;

  -- DEDUP: por DOCUMENTO (forte), senão por NOME normalizado. Achou → reusa (não duplica a base de cobrança).
  IF v_doc IS NOT NULL THEN
    SELECT id INTO v_id FROM erp_clientes
     WHERE company_id = p_company_id
       AND regexp_replace(COALESCE(cpf_cnpj, cnpj_cpf, ''), '\D', '', 'g') = v_doc
     LIMIT 1;
  END IF;
  IF v_id IS NULL AND v_norm <> '' THEN
    SELECT id INTO v_id FROM erp_clientes
     WHERE company_id = p_company_id
       AND unaccent(lower(btrim(regexp_replace(COALESCE(nome_fantasia, razao_social, ''), '\s+', ' ', 'g')))) = v_norm
     LIMIT 1;
  END IF;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

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

-- 2) vincular cliente à OS: PROPAGA cliente_id + cliente_nome PARA A OS (não só o título).
--    Bloqueia OS já faturada (título já existe; trocar aqui não repropaga p/ ele — é correção de finanças).
CREATE OR REPLACE FUNCTION public.fn_os_vincular_cliente(p_company_id uuid, p_os_id uuid, p_cliente_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_nome text; v_ja_faturada boolean;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT (COALESCE(titulos_gerados,false) OR lancamento_id IS NOT NULL) INTO v_ja_faturada
    FROM erp_os WHERE id = p_os_id AND company_id = p_company_id;
  IF v_ja_faturada IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'os_nao_encontrada'); END IF;
  IF v_ja_faturada THEN RETURN jsonb_build_object('ok', false, 'erro', 'ja_faturada'); END IF;
  SELECT COALESCE(NULLIF(trim(nome_fantasia),''), NULLIF(trim(razao_social),'')) INTO v_nome
    FROM erp_clientes WHERE id = p_cliente_id AND company_id = p_company_id;
  IF v_nome IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'cliente_nao_encontrado'); END IF;

  UPDATE erp_os SET cliente_id = p_cliente_id, cliente_nome = v_nome, updated_at = now()
   WHERE id = p_os_id AND company_id = p_company_id;

  RETURN jsonb_build_object('ok', true, 'cliente_id', p_cliente_id, 'cliente_nome', v_nome);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_os_vincular_cliente(uuid, uuid, uuid) TO authenticated;
