-- =============================================================
-- FEAT-FORNECEDOR-CONTATO-RPC-v3 · fn_fornecedor_contato_salvar
-- =============================================================
-- RPC que deriva company_id do proprio fornecedor · mata dependencia
-- de companyId vir do frontend (que estava bloqueando o save quando
-- a empresa nao estava selecionada / propagada).
--
-- Insert (p_contato_id IS NULL) ou update conforme p_contato_id.
-- SECURITY DEFINER · grant para authenticated · RLS bypass controlado
-- pelo proprio lookup de erp_fornecedores (fornecedor_id eh a chave).
--
-- Aplicada via MCP em 2026-06-13.
-- =============================================================

CREATE OR REPLACE FUNCTION public.fn_fornecedor_contato_salvar(
  p_fornecedor_id uuid, p_nome text, p_telefone text DEFAULT NULL,
  p_cargo text DEFAULT NULL, p_principal boolean DEFAULT false, p_contato_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_id uuid;
BEGIN
  IF p_nome IS NULL OR btrim(p_nome)='' THEN RETURN jsonb_build_object('ok',false,'erro','Nome obrigatorio'); END IF;
  SELECT company_id INTO v_company FROM erp_fornecedores WHERE id = p_fornecedor_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','Fornecedor nao encontrado'); END IF;

  IF p_contato_id IS NULL THEN
    INSERT INTO erp_fornecedor_contatos (company_id, fornecedor_id, nome, telefone, cargo, principal, ativo)
    VALUES (v_company, p_fornecedor_id, btrim(p_nome), NULLIF(btrim(p_telefone),''),
            NULLIF(btrim(p_cargo),''), COALESCE(p_principal,false), true)
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_fornecedor_contatos
       SET nome=btrim(p_nome), telefone=NULLIF(btrim(p_telefone),''), cargo=NULLIF(btrim(p_cargo),''),
           principal=COALESCE(p_principal,false), updated_at=now()
     WHERE id=p_contato_id AND fornecedor_id=p_fornecedor_id RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('ok',true,'contato_id',v_id);
END; $function$;

GRANT EXECUTE ON FUNCTION public.fn_fornecedor_contato_salvar TO authenticated;
