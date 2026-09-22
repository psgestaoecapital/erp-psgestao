-- Revenda · T6 (juiz) — checklist da vistoria CONFIGURÁVEL por empresa e tipo de veículo.
-- Hoje só existiam fn_insp_modelo_semear/_rapido (semeiam o modelo padrão). Aqui entram os RPCs de EDIÇÃO
-- dos itens do checklist da empresa (por modo rápida/completa e por tipo de veículo), reusando a estrutura
-- insp_modelo → insp_regiao → insp_item. A "completa" segue como modelo padrão; a empresa ajusta os itens.
-- Modelos são POR EMPRESA (insp_modelo.company_id), então a edição é isolada por tenant. SECURITY DEFINER
-- com guarda de empresa explícita + REVOKE anon (CEO / #1681). Sem coluna de autoria nestas tabelas.

-- guarda: a região pertence a um modelo DESTA empresa?
CREATE OR REPLACE FUNCTION public.fn_insp_regiao_da_empresa(p_regiao_id uuid, p_company_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM insp_regiao r JOIN insp_modelo m ON m.id = r.modelo_id
                 WHERE r.id = p_regiao_id AND m.company_id = p_company_id)
$function$;

-- obter o checklist da empresa (modo + tipo). Semeia o modelo se ainda não existir, para a empresa ter o
-- padrão para editar. Devolve regiões (com foto obrigatória) e itens ATIVOS, na ordem.
CREATE OR REPLACE FUNCTION public.fn_insp_checklist_obter(p_company_id uuid, p_modo text, p_tipo text DEFAULT 'carro')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_modelo uuid; v_regs jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_modo NOT IN ('rapida','completa') THEN RETURN jsonb_build_object('ok', false, 'erro', 'modo_invalido'); END IF;

  SELECT id INTO v_modelo FROM insp_modelo
   WHERE company_id = p_company_id AND escopo = 'veiculo_revenda' AND modo = p_modo AND tipo_alvo = p_tipo AND ativo = true
   ORDER BY padrao DESC LIMIT 1;
  IF v_modelo IS NULL THEN
    IF p_modo = 'rapida' THEN
      v_modelo := (fn_insp_modelo_semear_rapido(p_company_id)->>'modelo_id')::uuid;
    ELSE
      v_modelo := (fn_insp_modelo_semear(p_company_id, 'veiculo_revenda', p_tipo)->>'modelo_id')::uuid;
    END IF;
  END IF;
  IF v_modelo IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_modelo'); END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.ordem), '[]'::jsonb) INTO v_regs FROM (
    SELECT r.id AS regiao_id, r.codigo, r.nome, r.ordem, r.foto_obrigatoria,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('item_id', i.id, 'nome', i.nome, 'ordem', i.ordem, 'categoria_custo', i.categoria_custo) ORDER BY i.ordem)
                     FROM insp_item i WHERE i.regiao_id = r.id AND i.ativo = true), '[]'::jsonb) AS itens
    FROM insp_regiao r WHERE r.modelo_id = v_modelo
  ) x;
  RETURN jsonb_build_object('ok', true, 'modelo_id', v_modelo, 'modo', p_modo, 'tipo', p_tipo, 'regioes', v_regs);
END $function$;

-- inserir/editar um item do checklist (guarda por empresa via a região)
CREATE OR REPLACE FUNCTION public.fn_insp_item_upsert(p_company_id uuid, p_regiao_id uuid, p_nome text, p_categoria_custo text DEFAULT NULL, p_item_id uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_nome text := NULLIF(btrim(p_nome), ''); v_id uuid; v_reg uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_nome IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nome_obrigatorio'); END IF;

  IF p_item_id IS NOT NULL THEN
    SELECT regiao_id INTO v_reg FROM insp_item WHERE id = p_item_id;
    IF v_reg IS NULL OR NOT fn_insp_regiao_da_empresa(v_reg, p_company_id) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'item_de_outra_empresa'); END IF;
    UPDATE insp_item SET nome = v_nome, categoria_custo = NULLIF(btrim(p_categoria_custo), '') WHERE id = p_item_id
    RETURNING id INTO v_id;
  ELSE
    IF NOT fn_insp_regiao_da_empresa(p_regiao_id, p_company_id) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'regiao_de_outra_empresa'); END IF;
    INSERT INTO insp_item (regiao_id, nome, ordem, ativo, categoria_custo)
    VALUES (p_regiao_id, v_nome,
            COALESCE((SELECT max(ordem) + 1 FROM insp_item WHERE regiao_id = p_regiao_id), 1),
            true, NULLIF(btrim(p_categoria_custo), ''))
    RETURNING id INTO v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'item_id', v_id);
END $function$;

-- remover (soft: ativo=false, preserva respostas históricas) um item do checklist
CREATE OR REPLACE FUNCTION public.fn_insp_item_remover(p_company_id uuid, p_item_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_reg uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT regiao_id INTO v_reg FROM insp_item WHERE id = p_item_id;
  IF v_reg IS NULL OR NOT fn_insp_regiao_da_empresa(v_reg, p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'item_de_outra_empresa'); END IF;
  UPDATE insp_item SET ativo = false WHERE id = p_item_id;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- grants: SECURITY DEFINER sem anon (CEO / #1681)
REVOKE ALL ON FUNCTION public.fn_insp_regiao_da_empresa(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_insp_checklist_obter(uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_insp_item_upsert(uuid,uuid,text,text,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_insp_item_remover(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_insp_regiao_da_empresa(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_insp_checklist_obter(uuid,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_insp_item_upsert(uuid,uuid,text,text,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_insp_item_remover(uuid,uuid) TO authenticated, service_role;
