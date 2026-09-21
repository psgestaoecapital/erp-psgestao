-- Revenda · item 2c-b — CRUD das regras de comissão do vendedor (veic_comissao_regra).
--
-- As regras (por tipo de atendimento: trouxe a venda, atendeu na loja, etc.) definem a comissão e,
-- via `usar_na_precificacao`, QUAL delas precifica o estoque (item 3). Faltava a empresa poder
-- editá-las. Genérico, por empresa; gate PS_ADMIN/dono (get_user_company_ids/is_admin). Aditivo (RD-55).
-- No máximo UMA regra pode precificar (o índice parcial do #1654 garante; aqui validamos antes e damos
-- erro claro). Salvar substitui o conjunto da empresa (replace-all) — sem dependências por id.

CREATE OR REPLACE FUNCTION public.fn_veic_comissao_regras_obter(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'tipo_atendimento', tipo_atendimento, 'base', base, 'percentual', percentual,
      'valor_fixo', valor_fixo, 'rotulo', rotulo, 'usar_na_precificacao', usar_na_precificacao,
      'ativo', ativo, 'ordem', ordem) ORDER BY ordem, created_at), '[]'::jsonb)
    INTO v FROM veic_comissao_regra WHERE company_id = p_company_id;
  RETURN jsonb_build_object('ok', true, 'regras', v);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_veic_comissao_regras_salvar(p_company_id uuid, p_regras jsonb, p_user uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r jsonb; v_marcadas int := 0; v_ordem int := 0; v_base text;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_regras IS NULL OR jsonb_typeof(p_regras) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'regras_invalidas'); END IF;

  -- validações: base do enum; no máximo uma marcada p/ precificar.
  FOR r IN SELECT * FROM jsonb_array_elements(p_regras) LOOP
    v_base := r->>'base';
    IF v_base IS NULL OR v_base NOT IN ('fipe','fixo','preco','lucro') THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'base_invalida', 'valor', v_base); END IF;
    IF COALESCE((r->>'usar_na_precificacao')::boolean, false) THEN v_marcadas := v_marcadas + 1; END IF;
  END LOOP;
  IF v_marcadas > 1 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'mais_de_uma_regra_precifica'); END IF;

  -- replace-all: substitui o conjunto da empresa (sem dependências por id).
  DELETE FROM veic_comissao_regra WHERE company_id = p_company_id;
  FOR r IN SELECT * FROM jsonb_array_elements(p_regras) LOOP
    IF COALESCE(btrim(r->>'tipo_atendimento'),'') = '' THEN CONTINUE; END IF;
    v_ordem := v_ordem + 1;
    INSERT INTO veic_comissao_regra (company_id, tipo_atendimento, base, percentual, valor_fixo, rotulo, usar_na_precificacao, ativo, ordem)
    VALUES (p_company_id, btrim(r->>'tipo_atendimento'), r->>'base',
            NULLIF(r->>'percentual','')::numeric, NULLIF(r->>'valor_fixo','')::numeric,
            NULLIF(btrim(r->>'rotulo'),''), COALESCE((r->>'usar_na_precificacao')::boolean, false),
            COALESCE((r->>'ativo')::boolean, true), COALESCE((r->>'ordem')::int, v_ordem));
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'total', (SELECT count(*) FROM veic_comissao_regra WHERE company_id = p_company_id));
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_veic_comissao_regras_obter(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_comissao_regras_salvar(uuid, jsonb, uuid) TO authenticated, service_role;
