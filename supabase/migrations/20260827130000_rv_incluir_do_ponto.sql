-- RV-FONTE-IOPOINT · incluir participante da RV a partir do IO Point (ind_ponto_colaborador),
-- garantindo o registro em compliance_funcionarios por CPF antes de gravar (a FK
-- rh_rv_participante.funcionario_id → compliance_funcionarios é preservada — RD-53).
--
-- Fonte da verdade de quem trabalha = ind_ponto_colaborador (IO Point). O dropdown da RV passa a
-- listar dali; ao incluir, casa por CPF (dígitos) com o compliance: usa o id existente OU cria o
-- registro (nome/cpf/função do ponto) e usa o novo id. Depois reusa fn_rh_rv_participante_salvar.
-- Casamento por CPF em DÍGITOS (o ponto grava sem máscara; o compliance às vezes com máscara).

CREATE OR REPLACE FUNCTION public.fn_rh_rv_participante_incluir_do_ponto(
  p_company_id uuid, p_ponto_id uuid, p_plano_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_cpf text; v_nome text; v_funcao text; v_cpf_d text;
  v_func_id uuid; v_criado boolean := false; v_res jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  -- valida o plano ANTES de mexer no compliance (evita registro órfão se o plano for inválido)
  IF NOT EXISTS (SELECT 1 FROM rh_rv_plano WHERE id = p_plano_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'plano_invalido');
  END IF;

  SELECT cpf, nome, funcao INTO v_cpf, v_nome, v_funcao
    FROM ind_ponto_colaborador WHERE id = p_ponto_id AND company_id = p_company_id;
  IF v_nome IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'colaborador_invalido');
  END IF;

  v_cpf_d := NULLIF(regexp_replace(COALESCE(v_cpf, ''), '\D', '', 'g'), '');
  IF v_cpf_d IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'colaborador_sem_cpf');
  END IF;

  -- casa por CPF (dígitos); se não existe no compliance, cria a partir do dado do ponto
  SELECT id INTO v_func_id FROM compliance_funcionarios
    WHERE company_id = p_company_id AND regexp_replace(COALESCE(cpf, ''), '\D', '', 'g') = v_cpf_d
    LIMIT 1;
  IF v_func_id IS NULL THEN
    INSERT INTO compliance_funcionarios (company_id, nome_completo, cpf, cargo, funcao, ativo)
    VALUES (p_company_id, v_nome, v_cpf_d, v_funcao, v_funcao, true)
    RETURNING id INTO v_func_id;
    v_criado := true;
  END IF;

  -- reusa a RPC existente (valida funcionário/plano + ON CONFLICT por participante)
  v_res := public.fn_rh_rv_participante_salvar(p_company_id, v_func_id, p_plano_id, true);
  IF COALESCE((v_res->>'ok')::boolean, false) = false THEN
    RETURN v_res;
  END IF;

  RETURN jsonb_build_object('ok', true, 'funcionario_id', v_func_id,
    'participante_id', v_res->'id', 'criado_compliance', v_criado);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_rh_rv_participante_incluir_do_ponto(uuid,uuid,uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_rh_rv_participante_incluir_do_ponto(uuid,uuid,uuid) TO authenticated;
