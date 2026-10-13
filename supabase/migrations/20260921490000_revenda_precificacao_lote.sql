-- Revenda · R7a-2 (Pátio, T3) — reprecificação em LOTE com prévia da R2 (fonte única, RD-65).
--
-- O dono seleciona N carros no pátio e dá um novo preço (fixo) ou um reajuste % sobre o anunciado. Antes
-- de aplicar, vê a PRÉVIA por carro (piso de hoje, preço novo, margem projetada, se ficou abaixo do piso) —
-- a MESMA conta da tela de precificação (fn_veic_precificacao_simular). Ao confirmar, grava pelo caminho
-- oficial de UM carro (fn_veic_precificacao_salvar), que atualiza o preço e registra a linha do tempo do
-- valor (veic_precificacao_hist) — histórico por carro sai de graça. Nada de conta nova aqui.
--
-- p_aplicar=false → só a prévia (não grava). p_aplicar=true → aplica e devolve o resultado por carro.

CREATE OR REPLACE FUNCTION public.fn_veic_precificacao_lote(
  p_company_id  uuid,
  p_veiculo_ids uuid[],
  p_modo        text,          -- 'preco' (novo preço fixo) | 'ajuste_pct' (reajuste % sobre o anunciado)
  p_valor       numeric,
  p_aplicar     boolean DEFAULT false,
  p_user        uuid    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid; v_res jsonb := '[]'::jsonb; v_aplicados int := 0;
  v_atual numeric; v_novo numeric; v_modelo text; v_sim jsonb; v_salvo jsonb; v_erro text;
  -- autoria pela SESSÃO (auth.uid()), nunca pelo p_user do cliente (mesmo defeito já corrigido no perfil
  -- fiscal e na recusa de item). Sem sessão (service_role) → NULL, e o salvar registra como sistema.
  v_autor uuid := auth.uid();
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  IF p_modo NOT IN ('preco','ajuste_pct') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'modo_invalido');
  END IF;
  IF p_veiculo_ids IS NULL OR array_length(p_veiculo_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nenhum_veiculo');
  END IF;
  IF array_length(p_veiculo_ids, 1) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'lote_muito_grande');
  END IF;

  FOREACH v_id IN ARRAY p_veiculo_ids LOOP
    v_erro := NULL; v_novo := NULL;
    SELECT modelo, preco_venda INTO v_modelo, v_atual
      FROM veic_veiculo WHERE id = v_id AND company_id = p_company_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      v_res := v_res || jsonb_build_object('veiculo_id', v_id, 'erro', 'nao_encontrado'); CONTINUE;
    END IF;

    -- preço novo pelo modo
    IF p_modo = 'preco' THEN
      v_novo := round(COALESCE(p_valor,0), 2);
    ELSE -- ajuste_pct sobre o anunciado atual
      IF v_atual IS NULL OR v_atual <= 0 THEN
        v_res := v_res || jsonb_build_object('veiculo_id', v_id, 'modelo', v_modelo, 'preco_atual', v_atual,
                          'erro', 'sem_preco_atual'); CONTINUE;
      END IF;
      v_novo := round(v_atual * (1 + COALESCE(p_valor,0)/100.0), 2);
    END IF;
    IF v_novo IS NULL OR v_novo <= 0 THEN
      v_res := v_res || jsonb_build_object('veiculo_id', v_id, 'modelo', v_modelo, 'preco_atual', v_atual,
                        'erro', 'preco_novo_invalido'); CONTINUE;
    END IF;

    -- PRÉVIA pela fonte única da R2 (piso, margem projetada, abaixo do piso) para o preço novo
    v_sim := public.fn_veic_precificacao_simular(v_id, v_novo, NULL);

    IF p_aplicar THEN
      v_salvo := public.fn_veic_precificacao_salvar(v_id,
                   jsonb_build_object('preco_venda', v_novo::text, 'observacao', 'Reprecificação em lote (pátio)'),
                   v_autor);
      IF COALESCE((v_salvo->>'ok')::boolean, false) THEN v_aplicados := v_aplicados + 1;
      ELSE v_erro := COALESCE(v_salvo->>'erro', 'falha_ao_salvar'); END IF;
    END IF;

    v_res := v_res || jsonb_build_object(
      'veiculo_id', v_id, 'modelo', v_modelo,
      'preco_atual', v_atual, 'preco_novo', v_novo,
      'piso', v_sim->'preco_minimo',
      'margem_projetada', v_sim->'margem_projetada',
      'abaixo_do_piso', COALESCE((v_sim->>'abaixo_do_piso')::boolean, false),
      'comissao_nao_configurada', COALESCE((v_sim->>'comissao_nao_configurada')::boolean, false),
      'aplicado', (p_aplicar AND v_erro IS NULL),
      'erro', v_erro);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'total', array_length(p_veiculo_ids,1), 'aplicados', v_aplicados, 'resultados', v_res);
END;
$function$;

-- Saneamento: toda função nasce fechada. Revoga o EXECUTE implícito de PUBLIC/anon e concede só a quem deve.
REVOKE ALL ON FUNCTION public.fn_veic_precificacao_lote(uuid, uuid[], text, numeric, boolean, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_veic_precificacao_lote(uuid, uuid[], text, numeric, boolean, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_precificacao_lote(uuid, uuid[], text, numeric, boolean, uuid) TO authenticated, service_role;
-- p_user permanece na assinatura por compatibilidade com a tela, mas a AUTORIA usa auth.uid() (v_autor).
