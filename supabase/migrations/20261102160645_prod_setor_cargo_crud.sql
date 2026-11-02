-- Mão de obra da Indústria (tarefa eng_chefe 52cdf48a) — CRUD guardado de SETOR e CARGO.
-- As tabelas prod_setor / prod_cargo já existem (RLS por empresa). Esta PR acrescenta o caminho
-- validado de escrita (como a família prod_posto_*): trim do nome, nome duplicado tratado, e
-- EXCLUSÃO SEGURA que bloqueia apagar setor/cargo ainda em uso por posto ativo (sem órfão).
-- ADITIVA: só funções novas. Nenhuma tabela/policy/grant existente é alterada. UI em PR seguinte.

-- SETOR -----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_prod_setor_salvar(p_dados jsonb, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_id    uuid := NULLIF(p_dados->>'id','')::uuid;
  v_comp  uuid := NULLIF(p_dados->>'company_id','')::uuid;
  v_plant uuid := NULLIF(p_dados->>'plant_id','')::uuid;
  v_nome  text := btrim(coalesce(p_dados->>'nome',''));
  v_ordem int  := NULLIF(p_dados->>'ordem','')::int;
  v_criou boolean := false;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT company_id, plant_id INTO v_comp, v_plant FROM prod_setor WHERE id = v_id;
    IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'setor_nao_encontrado'); END IF;
  END IF;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'contexto_incompleto'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_nome = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'nome_obrigatorio'); END IF;

  BEGIN
    IF v_id IS NULL THEN
      SELECT coalesce(max(ordem),0) + 1 INTO v_ordem
        FROM prod_setor WHERE company_id = v_comp AND plant_id IS NOT DISTINCT FROM v_plant;
      INSERT INTO prod_setor (company_id, plant_id, nome, ordem, ativo)
      VALUES (v_comp, v_plant, v_nome, coalesce(v_ordem,1), true)
      RETURNING id INTO v_id;
      v_criou := true;
    ELSE
      UPDATE prod_setor
         SET nome = v_nome,
             ordem = coalesce(v_ordem, ordem),
             ativo = coalesce((p_dados->>'ativo')::boolean, ativo),
             updated_at = now()
       WHERE id = v_id;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nome_duplicado', 'nome', v_nome);
  END;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'criou', v_criou);
END $$;

CREATE OR REPLACE FUNCTION public.fn_prod_setor_excluir(p_id uuid, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_comp uuid; v_em_uso int;
BEGIN
  SELECT company_id INTO v_comp FROM prod_setor WHERE id = p_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'setor_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT count(*) INTO v_em_uso FROM prod_posto WHERE setor_id = p_id AND ativo IS NOT FALSE;
  IF v_em_uso > 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'setor_em_uso', 'postos', v_em_uso);
  END IF;
  UPDATE prod_setor SET ativo = false, updated_at = now() WHERE id = p_id;  -- soft-delete rastreável (RD-98)
  RETURN jsonb_build_object('ok', true);
END $$;

-- CARGO -----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_prod_cargo_salvar(p_dados jsonb, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_id    uuid := NULLIF(p_dados->>'id','')::uuid;
  v_comp  uuid := NULLIF(p_dados->>'company_id','')::uuid;
  v_plant uuid := NULLIF(p_dados->>'plant_id','')::uuid;
  v_nome  text := btrim(coalesce(p_dados->>'nome',''));
  v_criou boolean := false;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT company_id, plant_id INTO v_comp, v_plant FROM prod_cargo WHERE id = v_id;
    IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'cargo_nao_encontrado'); END IF;
  END IF;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'contexto_incompleto'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_nome = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'nome_obrigatorio'); END IF;

  BEGIN
    IF v_id IS NULL THEN
      INSERT INTO prod_cargo (company_id, plant_id, nome, ativo)
      VALUES (v_comp, v_plant, v_nome, true)
      RETURNING id INTO v_id;
      v_criou := true;
    ELSE
      UPDATE prod_cargo
         SET nome = v_nome,
             ativo = coalesce((p_dados->>'ativo')::boolean, ativo),
             updated_at = now()
       WHERE id = v_id;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nome_duplicado', 'nome', v_nome);
  END;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'criou', v_criou);
END $$;

CREATE OR REPLACE FUNCTION public.fn_prod_cargo_excluir(p_id uuid, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_comp uuid; v_em_uso int;
BEGIN
  SELECT company_id INTO v_comp FROM prod_cargo WHERE id = p_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'cargo_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT count(*) INTO v_em_uso FROM prod_posto WHERE cargo_id = p_id AND ativo IS NOT FALSE;
  IF v_em_uso > 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'cargo_em_uso', 'postos', v_em_uso);
  END IF;
  UPDATE prod_cargo SET ativo = false, updated_at = now() WHERE id = p_id;  -- soft-delete rastreável (RD-98)
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE EXECUTE ON FUNCTION public.fn_prod_setor_salvar(jsonb, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_prod_setor_excluir(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_prod_cargo_salvar(jsonb, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_prod_cargo_excluir(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_prod_setor_salvar(jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_prod_setor_excluir(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_prod_cargo_salvar(jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_prod_cargo_excluir(uuid, uuid) TO authenticated, service_role;
