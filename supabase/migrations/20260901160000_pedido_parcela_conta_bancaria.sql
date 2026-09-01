-- Tryo · faturamento de pedido — conta bancária POR PARCELA (espelho do §5/#1205, lado da venda).
-- Rodrigo travado: a parcela tem número/valor/vencimento/forma/"Boleto" (gerar_boleto), mas NÃO tem
-- onde escolher a conta bancária da cobrança. A Tryo tem ~19 contas ativas — não dá para inferir.
-- A informação existe no destino (erp_receber.conta_bancaria_id) e faltava na origem (a parcela).
-- Aditivo e OPCIONAL: parcela sem conta continua funcionando (conta_bancaria_id NULL).

-- 1) coluna nova na parcela do pedido (FK canônica erp_banco_contas, RD-44 igual ao §5)
ALTER TABLE public.erp_pedidos_parcelas
  ADD COLUMN IF NOT EXISTS conta_bancaria_id uuid REFERENCES public.erp_banco_contas(id);

-- 2) o saver aceita e persiste conta_bancaria_id por parcela (parcelas diferentes, bancos diferentes)
CREATE OR REPLACE FUNCTION public.fn_pedido_salvar_parcelas(p_pedido_id uuid, p_parcelas jsonb)
 RETURNS SETOF erp_pedidos_parcelas LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_total numeric(14,2); v_soma numeric(14,2);
BEGIN
  SELECT company_id, total INTO v_company, v_total FROM erp_pedidos WHERE id = p_pedido_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Pedido nao encontrado'; END IF;
  SELECT COALESCE(SUM((x->>'valor')::numeric),0) INTO v_soma FROM jsonb_array_elements(p_parcelas) x;
  IF ROUND(v_soma,2) <> ROUND(v_total,2) THEN
    RAISE EXCEPTION 'Soma das parcelas (R$ %) difere do total do pedido (R$ %)', v_soma, v_total;
  END IF;
  DELETE FROM erp_pedidos_parcelas WHERE pedido_id = p_pedido_id;
  INSERT INTO erp_pedidos_parcelas (company_id,pedido_id,numero,valor,vencimento,forma_pagamento,gerar_boleto,observacoes,conta_bancaria_id)
  SELECT v_company, p_pedido_id, (x->>'numero')::int, (x->>'valor')::numeric, (x->>'vencimento')::date,
         x->>'forma_pagamento', COALESCE((x->>'gerar_boleto')::boolean,false), x->>'observacoes',
         NULLIF(x->>'conta_bancaria_id','')::uuid
  FROM jsonb_array_elements(p_parcelas) x;
  UPDATE erp_pedidos SET
    parcelas = (SELECT COUNT(*) FROM erp_pedidos_parcelas WHERE pedido_id=p_pedido_id),
    primeiro_vencimento = (SELECT MIN(vencimento) FROM erp_pedidos_parcelas WHERE pedido_id=p_pedido_id),
    updated_at = now()
  WHERE id = p_pedido_id;
  RETURN QUERY SELECT * FROM erp_pedidos_parcelas WHERE pedido_id=p_pedido_id ORDER BY numero;
END $function$;

-- 3) fn_faturar repassa a conta da parcela ao erp_receber — cirúrgico no ramo de parcelas.
--    (Sem novo parâmetro: a conta já vem gravada na parcela; o faturar só a propaga.)
DO $$
DECLARE v_def text; v_new text; v_oc int; a text; b text; c text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc WHERE proname='fn_faturar' AND pronamespace='public'::regnamespace;
  IF v_def IS NULL THEN RAISE EXCEPTION 'fn_faturar nao encontrada'; END IF;
  IF position('v_parc.conta_bancaria_id' IN v_def) > 0 THEN RETURN; END IF;   -- idempotente

  -- A: o FOR lê a conta da parcela
  a := 'SELECT numero, valor, vencimento, forma_pagamento
                  FROM erp_pedidos_parcelas';
  v_oc := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  IF v_oc <> 1 THEN RAISE EXCEPTION 'fn_faturar ancora A esperava 1, achei %', v_oc; END IF;
  v_new := replace(v_def, a, 'SELECT numero, valor, vencimento, forma_pagamento, conta_bancaria_id
                  FROM erp_pedidos_parcelas');

  -- B: coluna no INSERT do erp_receber (ramo parcela; o ramo à-vista não tem forma_pagamento)
  b := 'numero_documento, descricao, forma_pagamento, created_at)';
  v_oc := (length(v_new) - length(replace(v_new, b, ''))) / length(b);
  IF v_oc <> 1 THEN RAISE EXCEPTION 'fn_faturar ancora B esperava 1, achei %', v_oc; END IF;
  v_new := replace(v_new, b, 'numero_documento, descricao, forma_pagamento, conta_bancaria_id, created_at)');

  -- C: valor correspondente
  c := 'v_parc.forma_pagamento, now())';
  v_oc := (length(v_new) - length(replace(v_new, c, ''))) / length(c);
  IF v_oc <> 1 THEN RAISE EXCEPTION 'fn_faturar ancora C esperava 1, achei %', v_oc; END IF;
  v_new := replace(v_new, c, 'v_parc.forma_pagamento, v_parc.conta_bancaria_id, now())');

  EXECUTE v_new;
END $$;
