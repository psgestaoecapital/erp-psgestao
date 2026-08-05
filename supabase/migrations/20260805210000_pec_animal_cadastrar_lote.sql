-- RD-41 · Agro/Pecuária (Estância Umuarama · Ivan) — cadastro de animais EM LOTE.
-- Hoje só cadastra 1 por vez (fn_pec_animal_salvar). A pecuária de corte pensa em lote ("comprei 50
-- bezerros") e só parte do rebanho tem brinco. Esta RPC cria N de uma vez, com flexibilidade de
-- identificação (individual OU coletivo) e peso — reusando erp_pec_animal (campos já nullable · RD-26).
--
-- Guardas: RD-26 (reusa a estrutura e a lógica do salvar); RD-51 (peso/identificação vêm do que o
-- usuário informa, sem valor inventado); Pilar 2 (multi-tenant); integridade (tudo-ou-nada — 1 função
-- plpgsql = 1 transação: erro no meio reverte o lote inteiro).

CREATE OR REPLACE FUNCTION public.fn_pec_animal_cadastrar_lote(
  p_company_id uuid, p_propriedade_id uuid, p_quantidade int,
  p_categoria text DEFAULT 'outro', p_sexo text DEFAULT NULL, p_raca text DEFAULT NULL,
  p_origem text DEFAULT 'comprado', p_data_entrada date DEFAULT NULL,
  p_lote_id uuid DEFAULT NULL, p_area_atual_id uuid DEFAULT NULL,
  p_contraparte_nome text DEFAULT NULL, p_modo_identificacao text DEFAULT 'coletivo',
  p_animais jsonb DEFAULT '[]'::jsonb, p_peso_medio_kg numeric DEFAULT NULL, p_observacao text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_modo text := lower(coalesce(p_modo_identificacao,'coletivo'));
  v_n int := coalesce(p_quantidade, 0);
  v_data date := coalesce(p_data_entrada, CURRENT_DATE);
  v_contra text := CASE WHEN p_origem = 'comprado' THEN nullif(btrim(coalesce(p_contraparte_nome,'')),'') ELSE NULL END;
  v_criados int := 0; v_it jsonb; v_qtd_itens int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;
  IF v_n < 1 THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe a quantidade de animais'); END IF;
  IF v_n > 5000 THEN RETURN jsonb_build_object('ok', false, 'erro', 'Quantidade acima do limite por lote (5000)'); END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_pec_propriedade WHERE id = p_propriedade_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Propriedade não encontrada nesta empresa');
  END IF;

  IF v_modo = 'individual' THEN
    -- 1 registro por item; cada um com seu brinco/sisbov/peso (todos opcionais · nullable ok).
    v_qtd_itens := coalesce(jsonb_array_length(p_animais), 0);
    IF v_qtd_itens <> v_n THEN
      RETURN jsonb_build_object('ok', false, 'erro',
        'A lista tem ' || v_qtd_itens || ' animal(is), mas a quantidade informada é ' || v_n);
    END IF;
    FOR v_it IN SELECT * FROM jsonb_array_elements(p_animais)
    LOOP
      INSERT INTO erp_pec_animal (company_id, propriedade_id, identificacao, sexo, categoria, raca, origem,
        data_entrada, peso_entrada_kg, lote_id, area_atual_id, sisbov, contraparte_nome, observacao,
        status, ativo, criado_por)
      VALUES (p_company_id, p_propriedade_id, nullif(btrim(v_it->>'identificacao'),''), p_sexo, p_categoria, p_raca, p_origem,
        v_data, nullif(v_it->>'peso_kg','')::numeric, p_lote_id, p_area_atual_id,
        nullif(btrim(v_it->>'sisbov'),''), v_contra, nullif(btrim(coalesce(p_observacao,'')),''),
        'ativo', true, auth.uid());
      v_criados := v_criados + 1;
    END LOOP;
  ELSE
    -- coletivo: N registros sem brinco (identificacao NULL), peso médio em cada (RD-51: o que o usuário informou).
    INSERT INTO erp_pec_animal (company_id, propriedade_id, identificacao, sexo, categoria, raca, origem,
      data_entrada, peso_entrada_kg, lote_id, area_atual_id, contraparte_nome, observacao, status, ativo, criado_por)
    SELECT p_company_id, p_propriedade_id, NULL, p_sexo, p_categoria, p_raca, p_origem,
      v_data, p_peso_medio_kg, p_lote_id, p_area_atual_id, v_contra, nullif(btrim(coalesce(p_observacao,'')),''),
      'ativo', true, auth.uid()
    FROM generate_series(1, v_n);
    v_criados := v_n;
  END IF;

  RETURN jsonb_build_object('ok', true, 'criados', v_criados, 'lote_id', p_lote_id, 'modo', v_modo);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_pec_animal_cadastrar_lote(uuid, uuid, int, text, text, text, text, date, uuid, uuid, text, text, jsonb, numeric, text) TO authenticated;
