-- ============================================================
-- Transferência entre contas (conciliação · item 3 Jordana). Onda 1.
-- Caso: cheque entra no Caixa; ao depositar, credita na Sicredi (+R$4.270 no extrato).
-- Regra contábil: transferência = 1 evento, 2 pernas (origem −, destino +). Zero no DRE,
-- zero no fluxo CONSOLIDADO (as pernas se cancelam), mas muda o saldo POR conta.
-- ============================================================

-- A.1 — Tabela de transferências entre contas (FKs → erp_banco_contas, a mesma de
-- conciliacao_lote.conta_bancaria_id).
CREATE TABLE IF NOT EXISTS public.erp_transferencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  conta_origem_id uuid NOT NULL REFERENCES public.erp_banco_contas(id),
  conta_destino_id uuid NOT NULL REFERENCES public.erp_banco_contas(id),
  valor numeric NOT NULL CHECK (valor > 0),
  data date NOT NULL,
  descricao text,
  movimento_id uuid REFERENCES public.conciliacao_movimento(id),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT erp_transferencia_contas_distintas CHECK (conta_origem_id <> conta_destino_id)
);
CREATE INDEX IF NOT EXISTS ix_transf_company_data ON public.erp_transferencia (company_id, data);
CREATE INDEX IF NOT EXISTS ix_transf_destino ON public.erp_transferencia (conta_destino_id);
CREATE INDEX IF NOT EXISTS ix_transf_origem ON public.erp_transferencia (conta_origem_id);

ALTER TABLE public.erp_transferencia ENABLE ROW LEVEL SECURITY;

-- A.1b — conciliacao_movimento.lancamento_tabela passa a aceitar 'erp_transferencia' (o check
-- só permitia erp_pagar/erp_receber/erp_lancamentos). Aditivo (só amplia o conjunto).
ALTER TABLE public.conciliacao_movimento DROP CONSTRAINT IF EXISTS cm_lanc_tabela_check;
ALTER TABLE public.conciliacao_movimento ADD CONSTRAINT cm_lanc_tabela_check
  CHECK (lancamento_tabela IS NULL OR lancamento_tabela = ANY (ARRAY['erp_pagar','erp_receber','erp_lancamentos','erp_transferencia']));

DROP POLICY IF EXISTS erp_transferencia_sel ON public.erp_transferencia;
CREATE POLICY erp_transferencia_sel ON public.erp_transferencia FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS erp_transferencia_ins ON public.erp_transferencia;
CREATE POLICY erp_transferencia_ins ON public.erp_transferencia FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

-- A.2 — RPC: conciliar um movimento como transferência entre contas.
CREATE OR REPLACE FUNCTION public.fn_conciliacao_transferir(
  p_movimento_id uuid, p_conta_contraparte_id uuid, p_descricao text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_mov RECORD; v_conta_mov uuid; v_origem uuid; v_destino uuid; v_transf_id uuid; v_ok_contra boolean;
BEGIN
  SELECT cm.company_id, cm.natureza, cm.valor, cm.data_transacao, cm.descricao, cm.status,
         l.conta_bancaria_id AS conta_mov
    INTO v_mov
  FROM conciliacao_movimento cm JOIN conciliacao_lote l ON l.id = cm.lote_id
  WHERE cm.id = p_movimento_id;
  IF v_mov.company_id IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','movimento nao encontrado'); END IF;
  IF v_mov.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF v_mov.status NOT IN ('pendente','divergente') THEN
    RETURN jsonb_build_object('ok',false,'erro','movimento ja processado: '||v_mov.status); END IF;

  v_conta_mov := v_mov.conta_mov;
  IF v_conta_mov IS NULL OR p_conta_contraparte_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'erro','conta indefinida'); END IF;
  IF v_conta_mov = p_conta_contraparte_id THEN
    RETURN jsonb_build_object('ok',false,'erro','origem e destino iguais'); END IF;

  -- a contraparte precisa ser uma conta da MESMA empresa (dinheiro saindo/entrando · RD-54).
  SELECT true INTO v_ok_contra FROM erp_banco_contas
   WHERE id = p_conta_contraparte_id AND company_id = v_mov.company_id;
  IF NOT COALESCE(v_ok_contra,false) THEN
    RETURN jsonb_build_object('ok',false,'erro','conta contraparte invalida'); END IF;

  -- crédito = dinheiro ENTROU na conta do movimento -> ela é o DESTINO
  IF lower(coalesce(v_mov.natureza,'')) IN ('credito','c') OR v_mov.valor > 0 THEN
    v_destino := v_conta_mov; v_origem := p_conta_contraparte_id;
  ELSE
    v_origem := v_conta_mov; v_destino := p_conta_contraparte_id;
  END IF;

  INSERT INTO erp_transferencia(company_id, conta_origem_id, conta_destino_id, valor, data, descricao, movimento_id)
  VALUES (v_mov.company_id, v_origem, v_destino, abs(v_mov.valor), v_mov.data_transacao,
          COALESCE(p_descricao, v_mov.descricao), p_movimento_id)
  RETURNING id INTO v_transf_id;

  -- lancamento_tabela='erp_transferencia' NÃO dispara baixa: fn_recompute_baixa_titulo já ignora
  -- tabelas != erp_pagar/erp_receber (guard existente · A.3 é no-op).
  UPDATE conciliacao_movimento
     SET status='conciliado', lancamento_tabela='erp_transferencia', lancamento_id=v_transf_id,
         match_origem='transferencia', match_aplicado_em=now(), match_aplicado_por=auth.uid(),
         updated_at=now()
   WHERE id = p_movimento_id;

  RETURN jsonb_build_object('ok',true,'transferencia_id',v_transf_id,
    'origem',v_origem,'destino',v_destino,'valor',abs(v_mov.valor));
END $function$;

-- A.4 — Popular o fluxo de caixa: as pernas somam POR conta; consolidado (p_conta_id NULL) = 0.
CREATE OR REPLACE FUNCTION public.fn_fluxo_caixa_diario(
  p_company_id uuid,
  p_data_inicio date DEFAULT ((CURRENT_DATE - '30 days'::interval))::date,
  p_data_fim date DEFAULT ((CURRENT_DATE + '30 days'::interval))::date,
  p_conta_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_saldo_inicial numeric;
  v_data_saldo_inicial date;
  v_resultado jsonb := '[]'::jsonb;
  v_saldo_acumulado numeric;
  v_dia record;
BEGIN
  SELECT COALESCE(SUM(saldo_inicial), 0), MIN(data_saldo_inicial)
    INTO v_saldo_inicial, v_data_saldo_inicial
  FROM erp_banco_contas
  WHERE company_id = p_company_id AND ativo = true
    AND COALESCE(soma_no_saldo, true) = true
    AND (p_conta_id IS NULL OR id = p_conta_id);

  v_saldo_acumulado := v_saldo_inicial;

  FOR v_dia IN
    SELECT
      d::date AS data,
      COALESCE((SELECT SUM(COALESCE(NULLIF(er.valor_pago, 0), er.valor, 0))
                FROM erp_receber er
                WHERE er.company_id = p_company_id AND er.data_pagamento = d::date
                  AND er.status IN ('pago', 'recebido')), 0) AS recebimentos,
      COALESCE((SELECT SUM(COALESCE(NULLIF(ep.valor_pago, 0), ep.valor, 0))
                FROM erp_pagar ep
                WHERE ep.company_id = p_company_id AND ep.data_pagamento = d::date
                  AND ep.status = 'pago'), 0) AS pagamentos,
      -- transferências: só POR conta (consolidado NULL = 0, pois as pernas se cancelam).
      COALESCE((SELECT SUM(t.valor) FROM erp_transferencia t
                WHERE t.company_id = p_company_id AND t.data = d::date
                  AND p_conta_id IS NOT NULL AND t.conta_destino_id = p_conta_id), 0) AS transferencias_entrada,
      COALESCE((SELECT SUM(t.valor) FROM erp_transferencia t
                WHERE t.company_id = p_company_id AND t.data = d::date
                  AND p_conta_id IS NOT NULL AND t.conta_origem_id = p_conta_id), 0) AS transferencias_saida
    FROM generate_series(p_data_inicio, p_data_fim, INTERVAL '1 day') AS d
  LOOP
    v_saldo_acumulado := v_saldo_acumulado + v_dia.recebimentos - v_dia.pagamentos
                         + v_dia.transferencias_entrada - v_dia.transferencias_saida;

    v_resultado := v_resultado || jsonb_build_object(
      'data', v_dia.data,
      'recebimentos', v_dia.recebimentos,
      'pagamentos', v_dia.pagamentos,
      'transferencias_entrada', v_dia.transferencias_entrada,
      'transferencias_saida', v_dia.transferencias_saida,
      'movimento_dia', v_dia.recebimentos - v_dia.pagamentos
                       + v_dia.transferencias_entrada - v_dia.transferencias_saida,
      'saldo_final', v_saldo_acumulado
    );
  END LOOP;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'periodo', jsonb_build_object('inicio', p_data_inicio, 'fim', p_data_fim),
    'saldo_inicial', v_saldo_inicial,
    'saldo_final', v_saldo_acumulado,
    'total_recebimentos', (SELECT SUM((d ->> 'recebimentos')::numeric) FROM jsonb_array_elements(v_resultado) d),
    'total_pagamentos', (SELECT SUM((d ->> 'pagamentos')::numeric) FROM jsonb_array_elements(v_resultado) d),
    'total_transferencias_entrada', (SELECT SUM((d ->> 'transferencias_entrada')::numeric) FROM jsonb_array_elements(v_resultado) d),
    'total_transferencias_saida', (SELECT SUM((d ->> 'transferencias_saida')::numeric) FROM jsonb_array_elements(v_resultado) d),
    'movimento_liquido', v_saldo_acumulado - v_saldo_inicial,
    'dias', v_resultado
  );
END;
$function$;
