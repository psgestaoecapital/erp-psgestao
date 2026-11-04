-- Mão de obra da Indústria (tarefa eng_chefe 52cdf48a) — ALOCAR / DESALOCAR pessoa no posto.
-- A tabela prod_posto_pessoa já existe (RLS por empresa) mas não tinha caminho validado de escrita.
-- Esta PR acrescenta, na mesma família de fn_prod_posto_* / fn_prod_salario_salvar:
--   * fn_prod_posto_pessoa_alocar  — abre a alocação (vigência). company_id/plant_id vêm do POSTO
--     (nunca do cliente); valida que o funcionário é da mesma empresa; encerra a vigência aberta
--     anterior do mesmo posto+pessoa (histórico, sem apagar linha);
--   * fn_prod_posto_pessoa_desalocar — encerra a alocação (vigencia_fim) de forma rastreável.
--   Ambas SECURITY DEFINER com a MESMA guarda (company_id IN get_user_company_ids() OR is_admin())
--   e rastro em audit_log_global. REVOKE anon.
-- ADITIVA: só funções novas. Nenhuma tabela/policy/grant existente é alterada. UI em PR seguinte.

-- ALOCAR -----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_prod_posto_pessoa_alocar(p_dados jsonb, p_user uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_posto uuid := NULLIF(p_dados->>'posto_id','')::uuid;
  v_func  uuid := NULLIF(p_dados->>'funcionario_id','')::uuid;
  v_cpf   text := NULLIF(btrim(coalesce(p_dados->>'cpf','')),'');
  v_turno uuid := NULLIF(p_dados->>'turno_id','')::uuid;
  v_ini   date := COALESCE(NULLIF(p_dados->>'vigencia_inicio','')::date, CURRENT_DATE);
  v_comp  uuid; v_plant uuid; v_id uuid; v_uid uuid := COALESCE(auth.uid(), p_user);
BEGIN
  IF v_posto IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'posto_obrigatorio'); END IF;
  SELECT company_id, plant_id INTO v_comp, v_plant FROM prod_posto WHERE id = v_posto;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'posto_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_plant IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'posto_sem_planta'); END IF;
  IF v_func IS NULL AND v_cpf IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_pessoa'); END IF;
  IF v_func IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM compliance_funcionarios WHERE id = v_func AND company_id = v_comp) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'funcionario_outra_empresa'); END IF;

  -- encerra a vigência aberta anterior do MESMO posto + pessoa (não duplica alocação ativa)
  UPDATE prod_posto_pessoa
     SET vigencia_fim = GREATEST(vigencia_inicio, v_ini - 1)
   WHERE posto_id = v_posto AND vigencia_fim IS NULL
     AND funcionario_id IS NOT DISTINCT FROM v_func
     AND (v_func IS NOT NULL OR cpf IS NOT DISTINCT FROM v_cpf);

  INSERT INTO prod_posto_pessoa (company_id, plant_id, posto_id, funcionario_id, cpf, turno_id, vigencia_inicio, criado_por)
  VALUES (v_comp, v_plant, v_posto, v_func, v_cpf, v_turno, v_ini, v_uid)
  RETURNING id INTO v_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_comp, v_uid, COALESCE((SELECT email FROM users WHERE id = v_uid), ''),
          'prod_posto_pessoa', v_id::text, 'posto_pessoa_alocar', NULL,
          jsonb_build_object('posto_id', v_posto, 'funcionario_id', v_func, 'cpf', v_cpf,
                             'turno_id', v_turno, 'vigencia_inicio', v_ini));

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- DESALOCAR --------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_prod_posto_pessoa_desalocar(p_id uuid, p_user uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.prod_posto_pessoa%ROWTYPE;
  v_uid uuid := COALESCE(auth.uid(), p_user);
BEGIN
  SELECT * INTO v_row FROM prod_posto_pessoa WHERE id = p_id;
  IF v_row.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'alocacao_nao_encontrada'); END IF;
  IF v_row.vigencia_fim IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'ja_encerrada'); END IF;
  IF NOT (v_row.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  UPDATE prod_posto_pessoa
     SET vigencia_fim = GREATEST(vigencia_inicio, CURRENT_DATE)
   WHERE id = p_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_row.company_id, v_uid, COALESCE((SELECT email FROM users WHERE id = v_uid), ''),
          'prod_posto_pessoa', v_row.id::text, 'posto_pessoa_desalocar',
          jsonb_build_object('posto_id', v_row.posto_id, 'funcionario_id', v_row.funcionario_id,
                             'vigencia_inicio', v_row.vigencia_inicio),
          jsonb_build_object('vigencia_fim', GREATEST(v_row.vigencia_inicio, CURRENT_DATE)));

  RETURN jsonb_build_object('ok', true, 'id', v_row.id);
END $function$;

REVOKE EXECUTE ON FUNCTION public.fn_prod_posto_pessoa_alocar(jsonb, uuid)   FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_prod_posto_pessoa_desalocar(uuid, uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_prod_posto_pessoa_alocar(jsonb, uuid)   TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.fn_prod_posto_pessoa_desalocar(uuid, uuid) TO authenticated, service_role;
