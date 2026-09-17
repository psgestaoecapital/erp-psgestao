-- ④ (CEO / Jordana) · origem_baixa: o título passa a registrar COMO foi baixado.
--
-- A Jordana (16/09): "eu esperava que o sistema soubesse ler COMO foi feita essa baixa. Essa informação
-- deveria constar no HISTÓRICO DO TÍTULO." Hoje o título diz só "pago" — não diz se foi retorno CNAB,
-- conciliação, baixa manual, permuta, dinheiro ou boleto. Sem isso, a auditoria vira adivinhação (o CEO
-- classificou 40+ títulos "no olho" pela conta/observação; permuta e dinheiro pareciam problema sem ser).
--
-- DESENHO (decisão do CEO):
--  • Coluna aditiva, NULLABLE. Enum de valores: retorno_cnab · conciliacao · manual · permuta · dinheiro ·
--    boleto · importacao. Guardamos também quem deu a baixa (baixado_por = auth.uid quando houver).
--  • DAqui pra frente (o que resolve de verdade): quem baixa grava a origem —
--      - baixa manual / retorno CNAB → fn_*_baixar_pagamento (fonte única). 'manual' é o default;
--        o retorno CNAB conciliar_auto baixa com forma='cnab' (marcador exclusivo do retorno, provado:
--        104 títulos, único uso de 'cnab' como forma) → o writer deriva 'retorno_cnab'.
--      - boleto liquidado → fn_boleto_liquidar passa 'boleto'.
--      - conciliação bancária → trigger determinístico: quando conciliado vira true (ou entra
--        movimento_banco_id), carimba 'conciliacao'. Só a conciliação escreve essas colunas — não é palpite,
--        e evita reescrever as 3 funções grandes de conciliação (risco no núcleo financeiro).
--  • BACKFILL CONSERVADOR (RD-38): só o que dá pra PROVAR pelo dado (conciliado/movimento, forma='cnab',
--    permuta na conta/forma/obs, dinheiro na forma/obs, boleto liquidado). O resto fica NULL — NUNCA
--    'manual' por suposição. Descartado o importado_em como origem-da-baixa (é origem do TÍTULO, não da
--    baixa: marcaria 5.559 errado — exatamente a inferência que vira mentira estrutural).
--  • EXIBIÇÃO: fn_pagar_historico devolve origem_baixa; a tela mostra "origem não registrada (baixa
--    anterior a set/2026)" quando NULL — nunca em branco mudo (senão a Jordana acha que é bug).
--
-- Fica para PR próprio: 'importacao' (linhas já-pagas importadas via planilha/ERP externo — inserts em TS).

-- ─────────────────────────────────────────────────────────────
-- 1) Colunas (aditivas, nullable) + CHECK do enum
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.erp_pagar
  ADD COLUMN IF NOT EXISTS origem_baixa text,
  ADD COLUMN IF NOT EXISTS baixado_por  uuid;
ALTER TABLE public.erp_receber
  ADD COLUMN IF NOT EXISTS origem_baixa text,
  ADD COLUMN IF NOT EXISTS baixado_por  uuid;

DO $$
BEGIN
  ALTER TABLE public.erp_pagar DROP CONSTRAINT IF EXISTS erp_pagar_origem_baixa_check;
  ALTER TABLE public.erp_pagar ADD CONSTRAINT erp_pagar_origem_baixa_check
    CHECK (origem_baixa IS NULL OR origem_baixa IN
      ('retorno_cnab','conciliacao','manual','permuta','dinheiro','boleto','importacao'));
  ALTER TABLE public.erp_receber DROP CONSTRAINT IF EXISTS erp_receber_origem_baixa_check;
  ALTER TABLE public.erp_receber ADD CONSTRAINT erp_receber_origem_baixa_check
    CHECK (origem_baixa IS NULL OR origem_baixa IN
      ('retorno_cnab','conciliacao','manual','permuta','dinheiro','boleto','importacao'));
END $$;

COMMENT ON COLUMN public.erp_pagar.origem_baixa IS
  'Como o título foi baixado: retorno_cnab/conciliacao/manual/permuta/dinheiro/boleto/importacao. '
  'NULL = baixa anterior a set/2026, sem registro (nunca inferir "manual").';
COMMENT ON COLUMN public.erp_receber.origem_baixa IS
  'Como o título foi baixado: retorno_cnab/conciliacao/manual/permuta/dinheiro/boleto/importacao. '
  'NULL = baixa anterior a set/2026, sem registro (nunca inferir "manual").';

-- ─────────────────────────────────────────────────────────────
-- 2) Fonte única de baixa (manual/retorno) grava a origem
--    Reproduz fielmente a versão vigente (20260720220000 — guarda anti-overpay, atômica) e SÓ acrescenta:
--    p_origem, origem_baixa e baixado_por. Default 'manual'; forma 'cnab' (retorno) → 'retorno_cnab'.
-- ─────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_pagar_baixar_pagamento(uuid, date, uuid, text, numeric);
CREATE OR REPLACE FUNCTION public.fn_pagar_baixar_pagamento(p_pagar_id uuid, p_data_pagamento date, p_conta_bancaria_id uuid, p_forma_pagamento text DEFAULT 'PIX'::text, p_valor_pago numeric DEFAULT NULL::numeric, p_origem text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_p record; v_baixa numeric; v_rows int; v_novo record; v_origem text;
BEGIN
  SELECT * INTO v_p FROM erp_pagar WHERE id = p_pagar_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta a pagar nao encontrada'); END IF;
  IF v_p.status = 'pago' THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta ja esta paga'); END IF;
  v_baixa := round(COALESCE(p_valor_pago, v_p.valor - COALESCE(v_p.valor_pago, 0)), 2);
  IF v_baixa <= 0 THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Valor da baixa deve ser maior que zero.'); END IF;

  -- ④ origem: o chamador manda (p_origem); senao, forma 'cnab' = retorno CNAB; senao, baixa manual.
  v_origem := COALESCE(p_origem,
                CASE WHEN lower(COALESCE(p_forma_pagamento,'')) = 'cnab' THEN 'retorno_cnab' ELSE 'manual' END);

  UPDATE erp_pagar
  SET valor_pago = round(COALESCE(valor_pago,0) + v_baixa, 2),
      status = CASE WHEN round(COALESCE(valor_pago,0)+v_baixa,2) >= valor - 0.01 THEN 'pago' ELSE 'parcial' END,
      data_pagamento = p_data_pagamento,
      forma_pagamento = p_forma_pagamento,
      origem_baixa = COALESCE(origem_baixa, v_origem),
      baixado_por  = COALESCE(baixado_por, auth.uid()),
      observacoes = COALESCE(observacoes, '') || ' [' || CASE WHEN round(COALESCE(valor_pago,0)+v_baixa,2) >= valor-0.01 THEN 'PAGO' ELSE 'PARCIAL' END
                    || ' ' || to_char(p_data_pagamento, 'DD/MM') || ': R$' || trim(to_char(v_baixa, 'FM999999990.00')) || ']',
      updated_at = NOW()
  WHERE id = p_pagar_id
    AND status <> 'pago'
    AND NOT (COALESCE(valor_pago,0) > 0 AND round(COALESCE(valor_pago,0)+v_baixa,2) > valor + 0.01);
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    SELECT * INTO v_p FROM erp_pagar WHERE id = p_pagar_id;
    IF v_p.status = 'pago' THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta ja esta paga', 'saldo_restante', 0); END IF;
    RETURN jsonb_build_object('sucesso', false, 'overpay', true,
      'erro', 'Esta baixa faria o pago ultrapassar o valor do titulo (possivel pagamento duplicado). Saldo: R$'
              || trim(to_char(GREATEST(v_p.valor - COALESCE(v_p.valor_pago,0),0), 'FM999999990.00'))
              || '. Para acrescimo (juros/multa), use os campos proprios.',
      'saldo_restante', GREATEST(round(v_p.valor - COALESCE(v_p.valor_pago,0),2), 0));
  END IF;

  SELECT * INTO v_novo FROM erp_pagar WHERE id = p_pagar_id;
  RETURN jsonb_build_object('sucesso', true, 'pagar_id', p_pagar_id, 'valor_baixa', v_baixa,
    'pago_acumulado', v_novo.valor_pago, 'saldo_restante', GREATEST(round(v_novo.valor - v_novo.valor_pago,2),0),
    'status_novo', v_novo.status);
END; $function$;
GRANT EXECUTE ON FUNCTION public.fn_pagar_baixar_pagamento(uuid, date, uuid, text, numeric, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.fn_receber_baixar_pagamento(uuid, date, uuid, text, numeric);
CREATE OR REPLACE FUNCTION public.fn_receber_baixar_pagamento(p_receber_id uuid, p_data_pagamento date, p_conta_bancaria_id uuid, p_forma_pagamento text DEFAULT 'PIX'::text, p_valor_pago numeric DEFAULT NULL::numeric, p_origem text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_r record; v_baixa numeric; v_rows int; v_novo record; v_origem text;
BEGIN
  SELECT * INTO v_r FROM erp_receber WHERE id = p_receber_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta a receber nao encontrada'); END IF;
  IF v_r.status = 'pago' THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta ja esta paga'); END IF;
  v_baixa := round(COALESCE(p_valor_pago, v_r.valor - COALESCE(v_r.valor_pago, 0)), 2);
  IF v_baixa <= 0 THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Valor da baixa deve ser maior que zero.'); END IF;

  v_origem := COALESCE(p_origem,
                CASE WHEN lower(COALESCE(p_forma_pagamento,'')) = 'cnab' THEN 'retorno_cnab' ELSE 'manual' END);

  UPDATE erp_receber
  SET valor_pago = round(COALESCE(valor_pago,0) + v_baixa, 2),
      status = CASE WHEN round(COALESCE(valor_pago,0)+v_baixa,2) >= valor - 0.01 THEN 'pago' ELSE 'parcial' END,
      data_pagamento = p_data_pagamento,
      forma_pagamento = p_forma_pagamento,
      origem_baixa = COALESCE(origem_baixa, v_origem),
      baixado_por  = COALESCE(baixado_por, auth.uid()),
      observacoes = COALESCE(observacoes, '') || ' [' || CASE WHEN round(COALESCE(valor_pago,0)+v_baixa,2) >= valor-0.01 THEN 'RECEBIDO' ELSE 'PARCIAL' END
                    || ' ' || to_char(p_data_pagamento, 'DD/MM') || ': R$' || trim(to_char(v_baixa, 'FM999999990.00')) || ']',
      updated_at = NOW()
  WHERE id = p_receber_id
    AND status <> 'pago'
    AND NOT (COALESCE(valor_pago,0) > 0 AND round(COALESCE(valor_pago,0)+v_baixa,2) > valor + 0.01);
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    SELECT * INTO v_r FROM erp_receber WHERE id = p_receber_id;
    IF v_r.status = 'pago' THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Conta ja esta paga', 'saldo_restante', 0); END IF;
    RETURN jsonb_build_object('sucesso', false, 'overpay', true,
      'erro', 'Esta baixa faria o recebido ultrapassar o valor do titulo (possivel duplicidade). Saldo: R$'
              || trim(to_char(GREATEST(v_r.valor - COALESCE(v_r.valor_pago,0),0), 'FM999999990.00')) || '.',
      'saldo_restante', GREATEST(round(v_r.valor - COALESCE(v_r.valor_pago,0),2), 0));
  END IF;

  SELECT * INTO v_novo FROM erp_receber WHERE id = p_receber_id;
  RETURN jsonb_build_object('sucesso', true, 'receber_id', p_receber_id, 'valor_baixa', v_baixa,
    'pago_acumulado', v_novo.valor_pago, 'saldo_restante', GREATEST(round(v_novo.valor - v_novo.valor_pago,2),0),
    'status_novo', v_novo.status, 'forma', p_forma_pagamento);
END; $function$;
GRANT EXECUTE ON FUNCTION public.fn_receber_baixar_pagamento(uuid, date, uuid, text, numeric, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 3) Boleto liquidado grava 'boleto'. Reproduz a versão VIGENTE (7 args, provider-agnóstica,
--    20260709000000 — NÃO a de 5 args de 20260630203000) e SÓ acrescenta p_origem := 'boleto'.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_boleto_liquidar(
  p_company_id uuid, p_nosso_numero text, p_data_pagamento date,
  p_valor_pago numeric DEFAULT NULL, p_provider_raw jsonb DEFAULT '{}'::jsonb,
  p_provider text DEFAULT 'sicoob', p_banco_codigo text DEFAULT '756')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_receber record; v_conta_id uuid; v_baixa jsonb;
BEGIN
  SELECT id, status, valor, boleto_status INTO v_receber
  FROM erp_receber
  WHERE company_id = p_company_id AND boleto_nosso_numero = p_nosso_numero
  ORDER BY boleto_emitido_em DESC NULLS LAST LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'recebivel_nao_encontrado', 'nosso_numero', p_nosso_numero);
  END IF;
  IF v_receber.boleto_status = 'liquidado' OR v_receber.status = 'pago' THEN
    RETURN jsonb_build_object('sucesso', true, 'ja_liquidado', true, 'receber_id', v_receber.id);
  END IF;

  -- conta destino: config ativa do provider (default sicoob)
  SELECT banco_conta_id INTO v_conta_id
  FROM erp_banco_provider_config
  WHERE company_id = p_company_id AND provider = p_provider AND ambiente = 'producao' AND ativo = true
  ORDER BY updated_at DESC NULLS LAST LIMIT 1;

  v_baixa := public.fn_receber_baixar_pagamento(
    p_receber_id := v_receber.id, p_data_pagamento := p_data_pagamento,
    p_conta_bancaria_id := v_conta_id, p_forma_pagamento := 'BOLETO',
    p_valor_pago := COALESCE(p_valor_pago, v_receber.valor),
    p_origem := 'boleto');

  IF COALESCE((v_baixa->>'sucesso')::boolean, false) = false THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'falha_baixa', 'detalhe', v_baixa, 'receber_id', v_receber.id);
  END IF;

  UPDATE erp_receber SET boleto_status = 'liquidado', boleto_pago_em = NOW() WHERE id = v_receber.id;

  IF p_provider_raw <> '{}'::jsonb THEN
    BEGIN
      INSERT INTO public.erp_banco_sync_log (company_id, banco_codigo, provider, tipo, status, qtd, mensagem, payload_resumo)
      VALUES (p_company_id, p_banco_codigo, p_provider, 'boleto_liquidar', 'ok', 1,
        format('nu=%s pago em %s', p_nosso_numero, p_data_pagamento), p_provider_raw);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'receber_id', v_receber.id, 'nosso_numero', p_nosso_numero, 'baixa', v_baixa);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_boleto_liquidar(uuid, text, date, numeric, jsonb, text, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 4) Conciliação → carimbo determinístico (trigger). Só a conciliação escreve conciliado/movimento_banco_id;
--    quando isso acontece e origem_baixa ainda está vazia, é conciliação. Evita mexer nas 3 funções grandes.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_trg_origem_baixa_conciliacao()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ( (NEW.conciliado IS TRUE AND COALESCE(OLD.conciliado,false) IS DISTINCT FROM TRUE)
       OR (NEW.movimento_banco_id IS NOT NULL AND OLD.movimento_banco_id IS NULL) )
     AND NEW.origem_baixa IS NULL THEN
    NEW.origem_baixa := 'conciliacao';
    NEW.baixado_por  := COALESCE(NEW.baixado_por, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_origem_baixa_conciliacao_pagar   ON public.erp_pagar;
DROP TRIGGER IF EXISTS trg_origem_baixa_conciliacao_receber ON public.erp_receber;
CREATE TRIGGER trg_origem_baixa_conciliacao_pagar
  BEFORE UPDATE OF conciliado, movimento_banco_id ON public.erp_pagar
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_origem_baixa_conciliacao();
CREATE TRIGGER trg_origem_baixa_conciliacao_receber
  BEFORE UPDATE OF conciliado, movimento_banco_id ON public.erp_receber
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_origem_baixa_conciliacao();

-- ─────────────────────────────────────────────────────────────
-- 5) Backfill CONSERVADOR (só o provável; resto fica NULL). Ordem = prioridade (1º match vence).
--    Toca só baixados sem origem e que casam um bucket — não dispara o trigger acima (não mexe em
--    conciliado/movimento_banco_id).
-- ─────────────────────────────────────────────────────────────
UPDATE public.erp_pagar SET origem_baixa = CASE
    WHEN conta_bancaria ILIKE '%permuta%' OR forma_pagamento ILIKE '%permuta%' OR observacoes ILIKE '%permuta%' THEN 'permuta'
    WHEN conciliado IS TRUE OR movimento_banco_id IS NOT NULL THEN 'conciliacao'
    WHEN lower(forma_pagamento) = 'cnab' THEN 'retorno_cnab'
    WHEN forma_pagamento ILIKE '%dinheiro%' OR observacoes ILIKE '%em dinheiro%' THEN 'dinheiro'
  END
WHERE deleted_at IS NULL AND status IN ('pago','parcial') AND origem_baixa IS NULL
  AND ( conta_bancaria ILIKE '%permuta%' OR forma_pagamento ILIKE '%permuta%' OR observacoes ILIKE '%permuta%'
        OR conciliado IS TRUE OR movimento_banco_id IS NOT NULL
        OR lower(forma_pagamento) = 'cnab'
        OR forma_pagamento ILIKE '%dinheiro%' OR observacoes ILIKE '%em dinheiro%' );

UPDATE public.erp_receber SET origem_baixa = CASE
    WHEN conta_bancaria ILIKE '%permuta%' OR forma_pagamento ILIKE '%permuta%' OR observacoes ILIKE '%permuta%' THEN 'permuta'
    WHEN conciliado IS TRUE OR movimento_banco_id IS NOT NULL THEN 'conciliacao'
    WHEN lower(forma_pagamento) = 'cnab' THEN 'retorno_cnab'
    WHEN boleto_pago_em IS NOT NULL OR boleto_status ILIKE '%liquid%' OR boleto_status ILIKE '%pag%' THEN 'boleto'
    WHEN forma_pagamento ILIKE '%dinheiro%' OR observacoes ILIKE '%em dinheiro%' THEN 'dinheiro'
  END
WHERE deleted_at IS NULL AND status IN ('pago','parcial') AND origem_baixa IS NULL
  AND ( conta_bancaria ILIKE '%permuta%' OR forma_pagamento ILIKE '%permuta%' OR observacoes ILIKE '%permuta%'
        OR conciliado IS TRUE OR movimento_banco_id IS NOT NULL
        OR lower(forma_pagamento) = 'cnab'
        OR boleto_pago_em IS NOT NULL OR boleto_status ILIKE '%liquid%' OR boleto_status ILIKE '%pag%'
        OR forma_pagamento ILIKE '%dinheiro%' OR observacoes ILIKE '%em dinheiro%' );

-- ─────────────────────────────────────────────────────────────
-- 6) Exibição: fn_pagar_historico devolve origem_baixa (reproduz 20260811120000 + a chave nova)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pagar_historico(p_pagar_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_p RECORD; v_eventos jsonb;
BEGIN
  SELECT * INTO v_p FROM erp_pagar WHERE id = p_pagar_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','conta nao encontrada'); END IF;
  IF v_p.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'origem','conciliacao',
           'data', cm.data_transacao,
           'valor', abs(cm.valor),
           'forma','conciliacao_bancaria',
           'descricao_banco', cm.descricao,
           'movimento_id', cm.id,
           'aplicado_em', cm.match_aplicado_em)
         ORDER BY cm.data_transacao)
    INTO v_eventos
    FROM conciliacao_movimento cm
   WHERE cm.lancamento_tabela='erp_pagar' AND cm.lancamento_id = p_pagar_id AND cm.status='conciliado';

  RETURN jsonb_build_object(
    'ok', true,
    'conta', jsonb_build_object(
       'id', v_p.id, 'descricao', v_p.descricao, 'valor', v_p.valor,
       'valor_pago', COALESCE(v_p.valor_pago,0), 'saldo', round(v_p.valor - COALESCE(v_p.valor_pago,0),2),
       'status', v_p.status, 'data_pagamento', v_p.data_pagamento,
       'forma_pagamento', v_p.forma_pagamento, 'conciliado', COALESCE(v_p.conciliado,false),
       'origem_baixa', v_p.origem_baixa),
    'eventos_conciliacao', COALESCE(v_eventos, '[]'::jsonb),
    'observacoes', v_p.observacoes
  );
END; $function$;
