-- Chamado #18 · E0370 — FASE A parte 2: gravar os dados fiscais da obra (CNO + endereço).
-- Sem isto o Rodrigo não tem onde preencher o que a trava pede (as 3 obras estão sem cidade/UF/CNO).
-- Não há fn de edição de obra hoje (ela nasce do orçamento) — este RPC preenche só os campos fiscais/endereço.

CREATE OR REPLACE FUNCTION public.fn_obra_salvar_fiscal(
  p_obra_id uuid,
  p_endereco text DEFAULT NULL, p_numero_endereco text DEFAULT NULL, p_bairro text DEFAULT NULL,
  p_cidade text DEFAULT NULL, p_uf text DEFAULT NULL, p_cep text DEFAULT NULL,
  p_codigo_ibge_municipio text DEFAULT NULL,
  p_cno text DEFAULT NULL, p_art text DEFAULT NULL, p_codigo_obra_municipal text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid;
BEGIN
  SELECT company_id INTO v_comp FROM projetos_obras WHERE id = p_obra_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- Só grava o que veio (NULL = não mexe), pra não zerar dado que já existia.
  UPDATE projetos_obras SET
    endereco              = COALESCE(NULLIF(btrim(p_endereco), ''), endereco),
    numero_endereco       = COALESCE(NULLIF(btrim(p_numero_endereco), ''), numero_endereco),
    bairro                = COALESCE(NULLIF(btrim(p_bairro), ''), bairro),
    cidade                = COALESCE(NULLIF(btrim(p_cidade), ''), cidade),
    uf                    = COALESCE(NULLIF(upper(btrim(p_uf)), ''), uf),
    cep                   = COALESCE(NULLIF(regexp_replace(COALESCE(p_cep,''),'[^0-9]','','g'), ''), cep),
    codigo_ibge_municipio = COALESCE(NULLIF(regexp_replace(COALESCE(p_codigo_ibge_municipio,''),'[^0-9]','','g'), ''), codigo_ibge_municipio),
    cno                   = COALESCE(NULLIF(btrim(p_cno), ''), cno),
    art                   = COALESCE(NULLIF(btrim(p_art), ''), art),
    codigo_obra_municipal = COALESCE(NULLIF(btrim(p_codigo_obra_municipal), ''), codigo_obra_municipal),
    updated_at            = now()
  WHERE id = p_obra_id;

  RETURN jsonb_build_object('ok', true);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_obra_salvar_fiscal(uuid, text, text, text, text, text, text, text, text, text, text) TO authenticated;

-- Helper: ler os dados fiscais de uma obra (pra a ficha e o seletor de emissão).
CREATE OR REPLACE FUNCTION public.fn_obra_fiscal_obter(p_obra_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  SELECT jsonb_build_object('ok', true,
      'id', o.id, 'nome', o.nome, 'numero', o.numero,
      'endereco', o.endereco, 'numero_endereco', o.numero_endereco, 'bairro', o.bairro,
      'cidade', o.cidade, 'uf', o.uf, 'cep', o.cep, 'codigo_ibge_municipio', o.codigo_ibge_municipio,
      'cno', o.cno, 'art', o.art, 'codigo_obra_municipal', o.codigo_obra_municipal,
      'tem_identificador', (COALESCE(o.cno,'') <> '' OR COALESCE(o.codigo_obra_municipal,'') <> ''),
      'endereco_completo', (COALESCE(o.endereco,'') <> '' AND COALESCE(o.cep,'') <> '' AND COALESCE(o.codigo_ibge_municipio,'') <> ''))
    INTO v FROM projetos_obras o
   WHERE o.id = p_obra_id AND (o.company_id IN (SELECT get_user_company_ids()) OR is_admin());
  RETURN COALESCE(v, jsonb_build_object('ok', false, 'erro', 'Obra não encontrada ou sem acesso'));
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_obra_fiscal_obter(uuid) TO authenticated;
