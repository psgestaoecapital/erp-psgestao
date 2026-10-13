-- Plano de Contas Gerenciais (DRE): CRUD de linhas CUSTOM por empresa em
-- psgc_contas_custom. Catalogo padrao psgc_contas (52 linhas, imutavel) e' a base;
-- a empresa adiciona subcontas custom sob um pai. Subconta herda natureza+dre_grupo
-- do pai; codigo auto (<pai>.C<seq>). Guard P2. Aplicada via MCP em 2026-07-08.
-- Dry-run validado: pai 1.1 -> receita/ROB, codigo 1.1.C1, arvore mesclada 53 nós.

CREATE OR REPLACE FUNCTION fn_psgc_pai_info(p_company_id uuid, p_pai_codigo text)
RETURNS TABLE(natureza text, dre_grupo text, dre_ordem integer)
LANGUAGE sql STABLE AS $$
  SELECT natureza, dre_grupo, dre_ordem FROM psgc_contas WHERE codigo = p_pai_codigo
  UNION ALL
  SELECT natureza, dre_grupo, dre_ordem FROM psgc_contas_custom
  WHERE codigo = p_pai_codigo AND company_id = p_company_id AND ativo
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION fn_psgc_contas_custom_criar(
  p_company_id uuid, p_pai_psgc_codigo text, p_nome text, p_descricao text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_nat text; v_grp text; v_ord int; v_seq int; v_codigo text;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids())) THEN RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;
  IF COALESCE(trim(p_nome),'') = '' THEN RAISE EXCEPTION 'Nome da conta obrigatorio'; END IF;
  IF COALESCE(trim(p_pai_psgc_codigo),'') = '' THEN RAISE EXCEPTION 'Conta pai obrigatoria'; END IF;
  SELECT natureza, dre_grupo, dre_ordem INTO v_nat, v_grp, v_ord FROM fn_psgc_pai_info(p_company_id, p_pai_psgc_codigo);
  IF v_nat IS NULL THEN RAISE EXCEPTION 'Conta pai % nao encontrada', p_pai_psgc_codigo; END IF;
  SELECT count(*) + 1 INTO v_seq FROM psgc_contas_custom WHERE company_id = p_company_id AND pai_psgc_codigo = p_pai_psgc_codigo;
  v_codigo := p_pai_psgc_codigo || '.C' || v_seq;
  INSERT INTO psgc_contas_custom
    (company_id, codigo, nome, pai_psgc_codigo, natureza, dre_grupo, dre_ordem, descricao, ativo, created_by)
  VALUES (p_company_id, v_codigo, trim(p_nome), p_pai_psgc_codigo, v_nat, v_grp,
          COALESCE(v_ord,999) + v_seq, NULLIF(trim(p_descricao),''), true, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_psgc_contas_custom_editar(
  p_id uuid, p_company_id uuid, p_nome text, p_descricao text DEFAULT NULL, p_ativo boolean DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids())) THEN RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;
  UPDATE psgc_contas_custom
  SET nome = COALESCE(NULLIF(trim(p_nome),''), nome),
      descricao = COALESCE(NULLIF(trim(p_descricao),''), descricao),
      ativo = COALESCE(p_ativo, ativo), updated_at = now()
  WHERE id = p_id AND company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta custom nao encontrada nesta empresa'; END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_psgc_contas_custom_excluir(p_id uuid, p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids())) THEN RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;
  UPDATE psgc_contas_custom SET ativo = false, updated_at = now()
  WHERE id = p_id AND company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta custom nao encontrada nesta empresa'; END IF;
END $$;

GRANT EXECUTE ON FUNCTION fn_psgc_pai_info(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_psgc_contas_custom_criar(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_psgc_contas_custom_editar(uuid,uuid,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_psgc_contas_custom_excluir(uuid,uuid) TO authenticated;
