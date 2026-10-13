-- R8c · Relatórios da Revenda (Onda 8). Uma fonte, um lugar: para cada VENDA no período, reusa
-- fn_veic_conta_do_carro (RD-65) para custo real/encargos/carrego/ROI e aplica o preço REALIZADO
-- (valor_venda) — nada de recalcular a conta do carro aqui. A tela agrega (por vendedor, por modelo,
-- curva de encalhe, acerto de precificação, sangria por mês). Comissão pela regra da empresa (veic_config).
-- Sem venda no período → itens vazio (a tela mostra "sem dados", RD-51, nunca zero fingido).

CREATE OR REPLACE FUNCTION public.fn_veic_relatorios_vendas(p_company_id uuid, p_de date, p_ate date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comis_pct numeric; v_comis_base text; r record; v_conta jsonb;
  v_custo numeric; v_enc numeric; v_lucro numeric; v_carrego numeric; v_base numeric; v_comis numeric; v_roi numeric;
  v_itens jsonb := '[]'::jsonb; v_dias int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT comissao_venda_pct, comissao_base INTO v_comis_pct, v_comis_base FROM veic_config WHERE company_id = p_company_id;

  FOR r IN
    SELECT vd.id AS venda_id, vd.veiculo_id, vd.valor_venda, vd.data_venda, vd.vendedor_nome,
           ve.marca, ve.modelo, ve.preco_venda AS anunciado, ve.data_entrada
    FROM veic_venda vd
    JOIN veic_veiculo ve ON ve.id = vd.veiculo_id
    WHERE vd.company_id = p_company_id AND vd.deleted_at IS NULL AND vd.devolvido_em IS NULL
      AND vd.data_venda BETWEEN p_de AND p_ate
    ORDER BY vd.data_venda
  LOOP
    v_conta  := fn_veic_conta_do_carro(r.veiculo_id);         -- fonte única do custo/encargos/carrego (RD-65)
    v_custo  := NULLIF(v_conta->>'custo_real_total','')::numeric;
    v_enc    := NULLIF(v_conta->>'encargos_pct','')::numeric;
    v_carrego := NULLIF(v_conta->'carrego'->>'total','')::numeric;
    -- lucro REALIZADO = preço de venda − encargos sobre o preço − custo real (mesma forma da conta do carro)
    v_lucro  := CASE WHEN r.valor_venda IS NULL THEN NULL
                     ELSE round(r.valor_venda * (1 - COALESCE(v_enc,0)/100.0) - COALESCE(v_custo,0), 2) END;
    v_base   := CASE WHEN v_comis_base = 'venda' THEN r.valor_venda ELSE GREATEST(COALESCE(v_lucro,0),0) END;
    v_comis  := round(COALESCE(v_base,0) * COALESCE(v_comis_pct,0)/100.0, 2);
    v_dias   := CASE WHEN r.data_entrada IS NOT NULL AND r.data_venda IS NOT NULL THEN (r.data_venda - r.data_entrada) END;
    v_roi    := CASE WHEN v_lucro IS NOT NULL AND COALESCE(v_custo,0) > 0 THEN round(v_lucro / v_custo * 100, 2) END;

    v_itens := v_itens || jsonb_build_object(
      'veiculo_id', r.veiculo_id, 'marca', r.marca, 'modelo', r.modelo,
      'vendedor', COALESCE(NULLIF(btrim(r.vendedor_nome),''), 'sem vendedor'),
      'data_venda', r.data_venda, 'mes', to_char(r.data_venda, 'YYYY-MM'),
      'dias_ate_vender', v_dias, 'valor_venda', r.valor_venda, 'anunciado', r.anunciado,
      'custo_real', v_custo, 'encargos_pct', v_enc, 'lucro_real', v_lucro,
      'comissao', v_comis, 'roi_pct', v_roi, 'carrego_total', v_carrego);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'de', p_de, 'ate', p_ate,
    'comissao_base', COALESCE(v_comis_base, 'lucro_real'), 'comissao_pct', v_comis_pct, 'itens', v_itens);
END $function$;

REVOKE ALL ON FUNCTION public.fn_veic_relatorios_vendas(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_relatorios_vendas(uuid,date,date) TO authenticated, service_role;
