-- OFICINA LOTE 1 · fn_os_faturar(os) — fecha o elo OS → GE (OS vira receita).
-- RD-26: REUSA o faturador canônico fn_faturar(pedido) — NÃO cria faturador paralelo.
--   fn_faturar gera erp_receber (parcelas ou à vista) + baixa estoque (itens/BOM) + marca o pedido.
-- RD-53: atômico (função plpgsql) — se falhar no meio, nada persiste; a OS não fica marcada sem título.
-- Idempotente: OS já faturada (titulos_gerados/lancamento_id) → bloqueia; fn_faturar também RAISE se o pedido já foi faturado.
-- RD-45: escopo company_id explícito. A tela financeira é da GE — a Oficina só dispara.
CREATE OR REPLACE FUNCTION public.fn_os_faturar(p_os_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_os record; v_res jsonb; v_first uuid;
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF v_os IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS não encontrada'); END IF;
  IF NOT (v_os.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF coalesce(v_os.titulos_gerados, false) OR v_os.lancamento_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Esta OS já foi faturada.');
  END IF;
  IF v_os.status NOT IN ('entregue', 'concluida', 'concluída', 'finalizada') THEN
    RETURN jsonb_build_object('ok', false, 'erro',
      'Só OS entregue/concluída pode ser faturada (situação atual: ' || coalesce(v_os.status, '?') || ').');
  END IF;
  IF v_os.pedido_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro',
      'Esta OS não tem pedido/orçamento vinculado — o faturamento sai do pedido.');
  END IF;

  -- REUSA o faturador canônico (RD-26). Se o pedido já foi faturado, ele RAISE → aborta tudo (atômico).
  v_res := public.fn_faturar(v_os.pedido_id, NULL);
  IF NOT coalesce((v_res->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'Falha ao faturar o pedido da OS: %', coalesce(v_res->>'erro', v_res::text);
  END IF;

  v_first := (v_res->'receber_ids'->>0)::uuid; -- 1º título gerado = elo da OS
  UPDATE erp_os SET titulos_gerados = true, lancamento_id = v_first, updated_at = now() WHERE id = p_os_id;

  RETURN jsonb_build_object('ok', true, 'os_numero', v_os.numero,
    'qtd_titulos', v_res->'qtd_titulos_receber', 'receber_ids', v_res->'receber_ids', 'lancamento_id', v_first);
END $$;

GRANT EXECUTE ON FUNCTION public.fn_os_faturar(uuid) TO authenticated;
