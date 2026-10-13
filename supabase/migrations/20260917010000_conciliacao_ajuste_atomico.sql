-- #38 (Jordana) · conciliação — baixa/ajuste sem vínculo. CAUSA PROVADA:
-- fn_conciliacao_ajustar_valores (1) ajusta o título (valor/juros/desconto) e (2) chama
-- fn_conciliacao_aplicar_match embutido — MAS ignorava o resultado do match e retornava
-- 'conciliado': (p_movimento_id IS NOT NULL) = SEMPRE true. Quando o aplicar_match voltava
-- 'erro' (ex.: "título já coberto", "movimento já processado"), a função NÃO dava RAISE →
-- o ajuste do título ficava commitado, o vínculo não acontecia, e ela reportava sucesso.
-- Resultado: título baixado/ajustado sem vínculo (14 casos achados em erp_pagar, ago/2026).
--
-- FIX (atomicidade): se o match embutido não voltar 'conciliado', RAISE — assim o ajuste do
-- título reverte na MESMA transação (nada de baixa/ajuste solto) e o cliente vê o erro real.
-- O 'conciliado' retornado passa a refletir o resultado do match, não a mera presença do movimento.
-- Só ACRESCENTA o guard; o resto é idêntico. RD-30/RD-53.

CREATE OR REPLACE FUNCTION public.fn_conciliacao_ajustar_valores(p_lancamento_id uuid, p_tipo text, p_valor_juros numeric DEFAULT 0, p_valor_desconto numeric DEFAULT 0, p_observacao text DEFAULT NULL::text, p_valor_novo numeric DEFAULT NULL::numeric, p_movimento_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_valor_atual numeric; v_valor_final numeric; v_company uuid; v_obs text := '';
        v_tabela text; v_match jsonb := NULL; v_match_status text;
BEGIN
  IF p_tipo = 'receber' THEN
    SELECT valor, company_id INTO v_valor_atual, v_company FROM erp_receber WHERE id = p_lancamento_id;
  ELSE
    SELECT valor, company_id INTO v_valor_atual, v_company FROM erp_pagar WHERE id = p_lancamento_id;
  END IF;
  IF v_valor_atual IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;

  v_valor_final := COALESCE(p_valor_novo, v_valor_atual);
  IF p_valor_novo IS NOT NULL AND round(p_valor_novo, 2) <> round(v_valor_atual, 2) THEN
    v_obs := v_obs || ' [VALOR AJUSTADO: R$' || to_char(v_valor_atual, 'FM999999990.00')
                   || ' → R$' || to_char(v_valor_final, 'FM999999990.00') || ' na conciliação]';
  END IF;
  IF p_observacao IS NOT NULL AND btrim(p_observacao) <> '' THEN
    v_obs := v_obs || ' [AJUSTE: ' || p_observacao || ']';
  END IF;

  IF p_tipo = 'receber' THEN
    UPDATE erp_receber SET valor = v_valor_final, juros = COALESCE(p_valor_juros,0),
      desconto = COALESCE(p_valor_desconto,0), observacoes = COALESCE(observacoes,'') || v_obs,
      updated_at = now() WHERE id = p_lancamento_id;
  ELSE
    UPDATE erp_pagar SET valor = v_valor_final, juros = COALESCE(p_valor_juros,0),
      desconto = COALESCE(p_valor_desconto,0), observacoes = COALESCE(observacoes,'') || v_obs,
      updated_at = now() WHERE id = p_lancamento_id;
  END IF;

  IF p_movimento_id IS NOT NULL THEN
    v_tabela := CASE WHEN p_tipo = 'receber' THEN 'erp_receber' ELSE 'erp_pagar' END;
    SELECT to_jsonb(t) INTO v_match
      FROM public.fn_conciliacao_aplicar_match(
             p_movimento_id, v_tabela, p_lancamento_id,
             auth.uid(), 'ajuste', 'Conciliado após ajuste de valores') t;

    -- 🔒 ATOMICIDADE (#38): se o match não conciliou, aborta TUDO (o ajuste do título acima reverte).
    -- Sem isto, o título ficava ajustado/baixado e o vínculo não — a baixa-sem-vínculo que a Jordana viu.
    v_match_status := COALESCE(v_match->>'status_resultado', 'erro');
    IF v_match_status <> 'conciliado' THEN
      RAISE EXCEPTION 'Conciliação não aplicada: %', COALESCE(v_match->>'mensagem', 'não foi possível vincular o movimento')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN jsonb_build_object('sucesso', true,
    'valor_original', v_valor_atual, 'valor_novo', v_valor_final,
    'valor_ajustado', round(v_valor_final + COALESCE(p_valor_juros,0) - COALESCE(p_valor_desconto,0), 2),
    'juros', COALESCE(p_valor_juros,0), 'desconto', COALESCE(p_valor_desconto,0),
    'conciliado', (p_movimento_id IS NOT NULL AND v_match_status = 'conciliado'), 'match', v_match);
END $function$;
