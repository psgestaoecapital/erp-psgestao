-- #297 Bradesco na baixa automática (CEO 01/10; manual API Cobrança v1.6.3).
-- A rota /api/boleto/sync-liquidacao passa a consultar o Bradesco (237): às 7h a LISTA de liquidados dos últimos 5 dias
-- (dados D-1) e a lista de baixados; às 13h a consulta individual dos boletos vencidos ou a vencer em 3 dias (status 13
-- "PAGO NO DIA"). Duas peças no banco:
--  1) fn_boleto_liquidar_banco: baixa pelo caminho de sempre (fn_boleto_liquidar — idempotente, conta do banco do
--     boleto) e REGISTRA A DIFERENÇA: pago acima do valor → juros (valor pago − valor); pago abaixo → a baixa fica
--     "parcial" (o Bradesco aceita pagamento parcial; não chamamos de desconto por conta própria) e volta sinalizado.
--  2) fn_boleto_marcar_baixado_banco: boleto BAIXADO no banco sem pagamento (pedido, decurso de prazo, protesto…) fica
--     marcado no ERP (boleto_status = 'baixado_banco' + código/descrição/data), SEM baixar o título como pago.

ALTER TABLE public.erp_receber ADD COLUMN IF NOT EXISTS boleto_baixa_banco_codigo integer;
ALTER TABLE public.erp_receber ADD COLUMN IF NOT EXISTS boleto_baixa_banco_descricao text;
ALTER TABLE public.erp_receber ADD COLUMN IF NOT EXISTS boleto_baixado_banco_em date;

CREATE OR REPLACE FUNCTION public.fn_boleto_liquidar_banco(p_company_id uuid, p_banco_codigo text, p_nosso_numero text,
  p_data_pagamento date, p_valor_pago numeric, p_provider_raw jsonb DEFAULT '{}'::jsonb, p_provider text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rec record; v_liq jsonb; v_dif numeric;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
  IF p_valor_pago IS NULL OR p_valor_pago <= 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'valor_pago_obrigatorio', 'nosso_numero', p_nosso_numero);
  END IF;
  SELECT id, valor, status, boleto_status INTO v_rec FROM erp_receber
   WHERE company_id = p_company_id AND boleto_banco_codigo = p_banco_codigo AND boleto_nosso_numero = p_nosso_numero AND deleted_at IS NULL
   ORDER BY boleto_emitido_em DESC NULLS LAST LIMIT 1;
  v_liq := public.fn_boleto_liquidar(p_company_id, p_nosso_numero, p_data_pagamento, p_valor_pago, p_provider_raw, p_provider, p_banco_codigo);
  IF NOT COALESCE((v_liq->>'sucesso')::boolean, false) OR COALESCE((v_liq->>'ja_liquidado')::boolean, false) THEN
    RETURN v_liq;
  END IF;
  v_dif := round(p_valor_pago - v_rec.valor, 2);
  IF v_dif > 0.01 THEN
    UPDATE erp_receber SET juros = v_dif,
           observacoes = COALESCE(observacoes, '') || ' [juros/encargos pagos no boleto: R$' || trim(to_char(v_dif, 'FM999999990.00')) || ']'
     WHERE id = v_rec.id;
  ELSIF v_dif < -0.01 THEN
    UPDATE erp_receber SET
           observacoes = COALESCE(observacoes, '') || ' [boleto pago a menor no banco: R$' || trim(to_char(-v_dif, 'FM999999990.00')) || ' — conferir desconto ou pagamento parcial]'
     WHERE id = v_rec.id;
  END IF;
  RETURN v_liq || jsonb_build_object('diferenca', v_dif,
    'tipo_diferenca', CASE WHEN v_dif > 0.01 THEN 'juros' WHEN v_dif < -0.01 THEN 'pago_a_menor' ELSE 'nenhuma' END);
END $function$;
REVOKE ALL ON FUNCTION public.fn_boleto_liquidar_banco(uuid, text, text, date, numeric, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_boleto_liquidar_banco(uuid, text, text, date, numeric, jsonb, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_boleto_marcar_baixado_banco(p_company_id uuid, p_banco_codigo text, p_nosso_numero text,
  p_codigo integer, p_descricao text, p_data date, p_provider_raw jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
  -- só boleto ainda registrado, em título não pago: o título continua como está (aberto/vencido) para a cobrança decidir
  UPDATE erp_receber SET boleto_status = 'baixado_banco', boleto_baixa_banco_codigo = p_codigo,
         boleto_baixa_banco_descricao = NULLIF(btrim(COALESCE(p_descricao, '')), ''), boleto_baixado_banco_em = COALESCE(p_data, current_date),
         observacoes = COALESCE(observacoes, '') || ' [boleto baixado no banco ' || COALESCE(p_banco_codigo, '') || ': ' || p_codigo
                       || COALESCE(' ' || NULLIF(btrim(p_descricao), ''), '') || ' — título NÃO foi baixado como pago]',
         updated_at = now()
   WHERE company_id = p_company_id AND boleto_banco_codigo = p_banco_codigo AND boleto_nosso_numero = p_nosso_numero
     AND deleted_at IS NULL AND boleto_status = 'registrado' AND status NOT IN ('pago', 'recebido', 'cancelado')
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('sucesso', true, 'ja_tratado', true, 'nosso_numero', p_nosso_numero); END IF;
  BEGIN
    INSERT INTO public.erp_banco_sync_log (company_id, banco_codigo, provider, tipo, status, qtd, mensagem, payload_resumo)
    VALUES (p_company_id, p_banco_codigo, 'bradesco', 'boleto_baixado_banco', 'ok', 1,
            format('nu=%s baixado no banco: %s %s', p_nosso_numero, p_codigo, COALESCE(p_descricao, '')), p_provider_raw);
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('sucesso', true, 'receber_id', v_id, 'nosso_numero', p_nosso_numero, 'codigo', p_codigo);
END $function$;
REVOKE ALL ON FUNCTION public.fn_boleto_marcar_baixado_banco(uuid, text, text, integer, text, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_boleto_marcar_baixado_banco(uuid, text, text, integer, text, date, jsonb) TO authenticated, service_role;
