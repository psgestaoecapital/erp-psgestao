-- #43 (Estância Umuarama) · "Quando cadastro o fornecedor direto na aba de lançamentos não fica salvo
-- para um novo lançamento futuro."
--
-- Provado no dado (27/09): a tela Nova despesa diz "Vamos cadastrar esse fornecedor pra você
-- automaticamente", mas nada cadastrava — fn_pagar_criar_com_parcelas(_v2) só grava o NOME no título.
-- Na Umuarama: 206 despesas com nome de fornecedor digitado e fornecedor_id vazio (30 nomes distintos).
-- O lado da receita já tinha fn_cliente_criar_inline; faltava o espelho do fornecedor.
--
-- fn_fornecedor_criar_inline: acha (por CPF/CNPJ, senão por nome normalizado) ou cria o fornecedor e
-- devolve o id. Não mexe em nenhum título existente — o vínculo dos 206 antigos é dado de cliente (RD-55).

CREATE OR REPLACE FUNCTION public.fn_fornecedor_criar_inline(
  p_company_id uuid,
  p_nome       text,
  p_cpf_cnpj   text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_id   uuid;
  v_doc  text := NULLIF(regexp_replace(COALESCE(p_cpf_cnpj, ''), '\D', '', 'g'), '');
  v_tp   text := CASE WHEN v_doc IS NOT NULL AND length(v_doc) = 11 THEN 'PF' ELSE 'PJ' END;
  v_norm text := unaccent(lower(btrim(regexp_replace(COALESCE(p_nome, ''), '\s+', ' ', 'g'))));
BEGIN
  IF auth.uid() IS NULL OR NOT (p_company_id IN (SELECT get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;
  IF COALESCE(btrim(p_nome), '') = '' THEN RAISE EXCEPTION 'Nome do fornecedor obrigatório'; END IF;

  -- DEDUP: documento (forte), senão nome normalizado. Achou → reusa (e reativa se estava inativo).
  IF v_doc IS NOT NULL THEN
    SELECT id INTO v_id FROM erp_fornecedores
     WHERE company_id = p_company_id
       AND regexp_replace(COALESCE(cpf_cnpj, cnpj_cpf, ''), '\D', '', 'g') = v_doc
     ORDER BY ativo DESC NULLS LAST, created_at
     LIMIT 1;
  END IF;
  IF v_id IS NULL AND v_norm <> '' THEN
    SELECT id INTO v_id FROM erp_fornecedores
     WHERE company_id = p_company_id
       AND (unaccent(lower(btrim(regexp_replace(COALESCE(nome_fantasia, ''), '\s+', ' ', 'g')))) = v_norm
         OR unaccent(lower(btrim(regexp_replace(COALESCE(razao_social, ''), '\s+', ' ', 'g')))) = v_norm)
     ORDER BY ativo DESC NULLS LAST, created_at
     LIMIT 1;
  END IF;
  IF v_id IS NOT NULL THEN
    UPDATE erp_fornecedores SET ativo = true, updated_at = now() WHERE id = v_id AND ativo IS DISTINCT FROM true;
    RETURN v_id;
  END IF;

  INSERT INTO erp_fornecedores (company_id, nome_fantasia, razao_social, cpf_cnpj, cnpj_cpf, tipo_pessoa, ativo)
  VALUES (p_company_id, btrim(p_nome), btrim(p_nome), NULLIF(btrim(p_cpf_cnpj), ''), NULLIF(btrim(p_cpf_cnpj), ''), v_tp, true)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_fornecedor_criar_inline(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fornecedor_criar_inline(uuid, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_fornecedor_criar_inline(uuid, text, text) IS
  '#43 · acha (CPF/CNPJ ou nome normalizado) ou cria o fornecedor digitado na tela de despesa e devolve o id.';
