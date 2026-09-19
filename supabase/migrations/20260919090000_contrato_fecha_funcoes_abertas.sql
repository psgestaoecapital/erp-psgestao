-- 🚨 Segurança (contexto 36215e77): 4 funções de contrato estavam SECURITY DEFINER com EXECUTE p/ anon
-- e SEM guarda de empresa — dava para escrever/processar contrato de qualquer empresa SEM login.
--   fn_contrato_aplicar_reajuste  (escreve valor + histórico + evento)
--   fn_contrato_gerar_pagar       (cria conta a pagar)
--   fn_contrato_processar_lote_diario (processa TODOS os contratos — batch multiempresa)
--   fn_contrato_evento_email      (trigger novo do #1556 — dispara e-mail)
-- Fecha: REVOKE anon/public; guarda padrão resolvendo a empresa PELO CONTRATO (sem JWT/service_role
-- passa → cron/triggers seguem; authenticated só na própria empresa → 42501). O lote diário é batch
-- multiempresa: não tem "uma empresa" para guardar → fica só service_role/interno (dono postgres/cron
-- executa mesmo após o REVOKE). Idempotente (CREATE OR REPLACE + REVOKE/GRANT). Corpo reproduzido fiel,
-- só a guarda e o SET search_path foram acrescentados.

-- ── 1 · fn_contrato_aplicar_reajuste — guarda de empresa (pelo contrato) + search_path ─────────────
CREATE OR REPLACE FUNCTION public.fn_contrato_aplicar_reajuste(p_contrato_id uuid, p_indice_aplicado numeric DEFAULT NULL::numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_contrato record;
  v_valor_anterior numeric;
  v_valor_novo numeric;
  v_indice numeric;
  v_proximo_reajuste date;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  SELECT * INTO v_contrato FROM erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'contrato nao encontrado');
  END IF;
  -- guarda de empresa: sem JWT (cron/interno) ou service_role passa; usuário só na própria empresa.
  IF NOT (v_interno OR auth.role() = 'service_role' OR v_contrato.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode = '42501';
  END IF;

  IF v_contrato.status != 'ativo' THEN
    RETURN jsonb_build_object('success', false, 'error', 'contrato nao esta ativo');
  END IF;

  v_valor_anterior := COALESCE(v_contrato.valor_atual, v_contrato.valor_mensal);
  v_indice := COALESCE(p_indice_aplicado, v_contrato.reajuste_percentual, 0);

  IF v_indice = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'nenhum indice de reajuste configurado');
  END IF;

  v_valor_novo := v_valor_anterior * (1 + v_indice / 100);
  v_proximo_reajuste := CURRENT_DATE + interval '1 year';

  UPDATE erp_contratos
  SET valor_atual = v_valor_novo,
      ultimo_reajuste_em = CURRENT_DATE,
      proximo_reajuste_em = v_proximo_reajuste,
      updated_at = now()
  WHERE id = p_contrato_id;

  INSERT INTO erp_contratos_reajustes (
    contrato_id, valor_anterior, valor_novo, percentual_aplicado, indice_referencia, aplicado_em, created_at
  ) VALUES (
    p_contrato_id, v_valor_anterior, v_valor_novo, v_indice,
    COALESCE(v_contrato.tipo_reajuste, 'manual'), CURRENT_DATE, now()
  );

  INSERT INTO erp_contratos_eventos (
    contrato_id, company_id, evento, detalhe, metadata, created_at
  ) VALUES (
    p_contrato_id, v_contrato.company_id, 'reajuste_aplicado',
    format('Reajuste de %s%% aplicado: R$ %s -> R$ %s',
      to_char(v_indice, 'FM990.00'),
      to_char(v_valor_anterior, 'FM999999990.00'),
      to_char(v_valor_novo, 'FM999999990.00')),
    jsonb_build_object('valor_anterior', v_valor_anterior, 'valor_novo', v_valor_novo,
      'percentual', v_indice, 'indice', v_contrato.tipo_reajuste),
    now()
  );

  RETURN jsonb_build_object('success', true, 'valor_anterior', v_valor_anterior, 'valor_novo', v_valor_novo,
    'percentual_aplicado', v_indice, 'proximo_reajuste_em', v_proximo_reajuste);
END;
$function$;

-- ── 2 · fn_contrato_gerar_pagar — guarda de empresa (pelo contrato) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_contrato_gerar_pagar(p_contrato_id uuid, p_mes_referencia date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_contrato record;
  v_ref_externa text;
  v_data_vencimento date;
  v_descricao text;
  v_pagar_id uuid;
  v_already_exists boolean;
  v_valor numeric;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  SELECT * INTO v_contrato FROM erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'contrato nao encontrado');
  END IF;
  -- guarda de empresa: sem JWT (cron/interno) ou service_role passa; usuário só na própria empresa.
  IF NOT (v_interno OR auth.role() = 'service_role' OR v_contrato.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode = '42501';
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

-- ── 3 · ACL: fecha o EXECUTE p/ anon/public nas quatro; guarda de empresa no corpo (1 e 2). ────────
-- Escritores por contrato: authenticated pode chamar (a guarda filtra a empresa).
REVOKE EXECUTE ON FUNCTION public.fn_contrato_aplicar_reajuste(uuid, numeric) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_contrato_aplicar_reajuste(uuid, numeric) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_contrato_gerar_pagar(uuid, date) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_contrato_gerar_pagar(uuid, date) TO authenticated, service_role;

-- Batch multiempresa: só serviço/interno. O dono (postgres) — que é quem o cron job 17 usa — executa
-- mesmo após o REVOKE, então o lote diário 06:00 segue funcionando. Sem authenticated (CEO).
REVOKE EXECUTE ON FUNCTION public.fn_contrato_processar_lote_diario(date) FROM anon, authenticated, public;
GRANT  EXECUTE ON FUNCTION public.fn_contrato_processar_lote_diario(date) TO service_role;

-- Trigger novo do #1556: só a trigger o invoca; ninguém precisa de EXECUTE direto. Fecha p/ todos.
REVOKE EXECUTE ON FUNCTION public.fn_contrato_evento_email() FROM anon, authenticated, public;
