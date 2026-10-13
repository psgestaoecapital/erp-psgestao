-- ============================================================================
-- RECORR-1 · Recorrência de DESPESA (Fase 1) — o motor de contratos recorrentes
-- (erp_contratos) passa a gerar contas A PAGAR além de a receber, reusando 100%
-- da infra existente (RD-26). Destrava salários/aluguel/consultoria recorrentes.
--
-- RD-53 (não-regressão): a receita segue idêntica. natureza default='receita';
-- o roteador só desvia quando natureza='despesa'. fn_contrato_gerar_receber NÃO
-- é alterada.
-- ============================================================================

-- 1.1 Natureza do contrato (os existentes ficam 'receita' pelo default).
ALTER TABLE public.erp_contratos
  ADD COLUMN IF NOT EXISTS natureza varchar(10) NOT NULL DEFAULT 'receita'
  CHECK (natureza IN ('receita','despesa'));

-- 1.2 Vínculo do contrato no a pagar (simetria com erp_receber.contrato_id).
ALTER TABLE public.erp_pagar
  ADD COLUMN IF NOT EXISTS contrato_id uuid REFERENCES public.erp_contratos(id);

-- 1.3 Espelho do motor: gerar conta A PAGAR a partir do contrato de despesa.
--     Mesma lógica/idempotência do fn_contrato_gerar_receber, gravando em erp_pagar.
--     Idempotência checada EM erp_pagar com deleted_at IS NULL (receita e despesa
--     nunca colidem: tabelas diferentes, mesmo padrão de ref_externa).
CREATE OR REPLACE FUNCTION public.fn_contrato_gerar_pagar(p_contrato_id uuid, p_mes_referencia date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_contrato record;
  v_ref_externa text;
  v_data_vencimento date;
  v_descricao text;
  v_pagar_id uuid;
  v_already_exists boolean;
  v_valor numeric;
BEGIN
  SELECT * INTO v_contrato FROM erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'contrato nao encontrado');
  END IF;

  IF v_contrato.natureza <> 'despesa' THEN
    RETURN jsonb_build_object('success', false, 'error', 'contrato nao e de despesa');
  END IF;

  IF v_contrato.status != 'ativo' THEN
    RETURN jsonb_build_object('success', false,
      'error', format('contrato esta com status %s, nao pode gerar', v_contrato.status));
  END IF;

  IF v_contrato.data_inicio > p_mes_referencia THEN
    RETURN jsonb_build_object('success', false, 'error', 'mes de referencia anterior ao inicio do contrato');
  END IF;

  IF v_contrato.data_fim IS NOT NULL AND v_contrato.data_fim < p_mes_referencia THEN
    RETURN jsonb_build_object('success', false, 'error', 'mes de referencia posterior ao fim do contrato');
  END IF;

  v_valor := COALESCE(v_contrato.valor_atual, v_contrato.valor_mensal);
  v_data_vencimento := date_trunc('month', p_mes_referencia)::date
    + (COALESCE(v_contrato.dia_vencimento, 10) - 1) * interval '1 day';
  v_ref_externa := format('contrato:%s:mes:%s', v_contrato.id, to_char(p_mes_referencia, 'YYYY-MM'));

  SELECT EXISTS(
    SELECT 1 FROM erp_pagar
    WHERE ref_externa_sistema = 'contrato_recorrente' AND ref_externa_id = v_ref_externa
      AND deleted_at IS NULL
  ) INTO v_already_exists;

  IF v_already_exists THEN
    RETURN jsonb_build_object('success', false, 'error', 'pagamento ja gerado para este mes',
      'ref_externa', v_ref_externa, 'idempotente', true);
  END IF;

  v_descricao := format('%s - Ref. %s', v_contrato.nome, to_char(p_mes_referencia, 'MM/YYYY'));

  INSERT INTO erp_pagar (
    company_id, fornecedor_id, fornecedor_nome, descricao, categoria, valor, valor_pago,
    data_emissao, data_competencia, data_vencimento, status, forma_pagamento,
    centro_custo, linha_negocio, observacoes, recorrente,
    ref_externa_id, ref_externa_sistema, contrato_id
  ) VALUES (
    v_contrato.company_id, v_contrato.cliente_id, v_contrato.cliente_nome, v_descricao,
    'Despesa Recorrente', v_valor, 0,
    p_mes_referencia, p_mes_referencia, v_data_vencimento, 'aberto', v_contrato.forma_pagamento,
    NULL, v_contrato.tipo,
    format('Gerado automaticamente do contrato %s em %s', v_contrato.numero, now()::date), true,
    v_ref_externa, 'contrato_recorrente', v_contrato.id
  )
  RETURNING id INTO v_pagar_id;

  UPDATE erp_contratos
  SET ultimo_titulo_gerado_em = CURRENT_DATE,
      total_titulos_gerados = COALESCE(total_titulos_gerados, 0) + 1,
      total_faturado = COALESCE(total_faturado, 0) + v_valor,
      updated_at = now()
  WHERE id = p_contrato_id;

  -- Evento na trilha do contrato (simetria com o motor de receita).
  INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, created_at)
  VALUES (
    p_contrato_id, v_contrato.company_id, 'fatura_gerada',
    format('Despesa gerada para %s no valor de R$ %s',
      to_char(p_mes_referencia, 'MM/YYYY'), to_char(v_valor, 'FM999999990.00')),
    jsonb_build_object('pagar_id', v_pagar_id, 'ref_externa', v_ref_externa,
      'data_vencimento', v_data_vencimento, 'valor', v_valor, 'natureza', 'despesa'),
    now()
  );

  RETURN jsonb_build_object('success', true, 'pagar_id', v_pagar_id, 'ref_externa', v_ref_externa,
    'valor', v_valor, 'data_vencimento', v_data_vencimento);
END;
$function$;

-- 2. Roteador diário: acrescenta `natureza` ao SELECT do loop e desvia despesa→gerar_pagar.
--    Todo o resto (contagem/exceção/retorno) permanece idêntico ao original.
CREATE OR REPLACE FUNCTION public.fn_contrato_processar_lote_diario(p_data_referencia date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_contrato record;
  v_resultado jsonb;
  v_total_processado int := 0;
  v_total_sucesso int := 0;
  v_total_erro int := 0;
  v_total_idempotente int := 0;
  v_erros jsonb := '[]'::jsonb;
  v_dia_atual int;
  v_mes_ref date;
BEGIN
  v_dia_atual := EXTRACT(DAY FROM p_data_referencia)::int;
  v_mes_ref := date_trunc('month', p_data_referencia)::date;

  FOR v_contrato IN
    SELECT id, numero, nome, dia_vencimento, periodicidade, natureza
    FROM erp_contratos
    WHERE status = 'ativo'
      AND COALESCE(dia_vencimento, 10) = v_dia_atual
      AND data_inicio <= p_data_referencia
      AND (data_fim IS NULL OR data_fim >= p_data_referencia)
      AND CASE periodicidade
        WHEN 'mensal' THEN true
        WHEN 'bimestral' THEN EXTRACT(MONTH FROM p_data_referencia)::int % 2 = EXTRACT(MONTH FROM data_inicio)::int % 2
        WHEN 'trimestral' THEN EXTRACT(MONTH FROM p_data_referencia)::int % 3 = EXTRACT(MONTH FROM data_inicio)::int % 3
        WHEN 'semestral' THEN EXTRACT(MONTH FROM p_data_referencia)::int % 6 = EXTRACT(MONTH FROM data_inicio)::int % 6
        WHEN 'anual' THEN EXTRACT(MONTH FROM p_data_referencia)::int = EXTRACT(MONTH FROM data_inicio)::int
        ELSE true
      END
  LOOP
    v_total_processado := v_total_processado + 1;

    BEGIN
      IF v_contrato.natureza = 'despesa' THEN
        v_resultado := fn_contrato_gerar_pagar(v_contrato.id, v_mes_ref);
      ELSE
        v_resultado := fn_contrato_gerar_receber(v_contrato.id, v_mes_ref);
      END IF;

      IF (v_resultado->>'success')::boolean THEN
        v_total_sucesso := v_total_sucesso + 1;
      ELSIF (v_resultado->>'idempotente')::boolean THEN
        v_total_idempotente := v_total_idempotente + 1;
      ELSE
        v_total_erro := v_total_erro + 1;
        v_erros := v_erros || jsonb_build_object(
          'contrato_id', v_contrato.id, 'numero', v_contrato.numero, 'erro', v_resultado->>'error');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_total_erro := v_total_erro + 1;
      v_erros := v_erros || jsonb_build_object(
        'contrato_id', v_contrato.id, 'numero', v_contrato.numero, 'erro', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true, 'data_referencia', p_data_referencia, 'mes_referencia', v_mes_ref,
    'dia_atual', v_dia_atual, 'total_processado', v_total_processado,
    'total_sucesso', v_total_sucesso, 'total_idempotente', v_total_idempotente,
    'total_erro', v_total_erro, 'erros', v_erros, 'executado_em', now());
END;
$function$;
