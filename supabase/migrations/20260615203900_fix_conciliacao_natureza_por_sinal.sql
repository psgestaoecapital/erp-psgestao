-- =============================================================
-- fix_conciliacao_natureza_por_sinal_v1
-- =============================================================
-- Sintoma: recebimento de cartao de debito ("CIELO/SICREDI DEBITO VISA")
-- aparecia como saida na inbox · tela oferecia Contas a Pagar para uma
-- entrada. 0 de 420 movs KGF tinham valor negativo (sinal vira natureza,
-- valor guardado em modulo · 4 movs com texto de maquininha de debito
-- ficaram errados).
--
-- Causa raiz (3 camadas):
-- 1. fn_conciliacao_criar_lote fazia COALESCE(...,'debito') -> trigger
--    nao distinguia "default" de "intencional".
-- 2. Trigger fn_conciliacao_movimento_before sobrescrevia natureza
--    qualquer vez que NEW.natureza='debito' (default) chegava.
-- 3. fn_normalizar_natureza_ofx caia em LIKE '%DEBITO%' para "CIELO/
--    SICREDI DEBITO" (recebimento de venda) -> classificava como saida.
--
-- Fix em 4 partes (idempotente):
-- 1. fn_normalizar_natureza_ofx · regras de maquininha de debito retornam
--    'credito' ANTES do match generico '%DEBITO%' (CIELO, SICREDI, REDE,
--    STONE, PAGSEGURO, MERCADO PAGO, GETNET, SAFRA).
-- 2. Trigger so normaliza por texto se NEW.natureza IS NULL.
--    Respeita 'credito'/'debito' explicito do frontend (que deriva do
--    SINAL do TRNAMT, fonte de verdade).
-- 3. fn_conciliacao_criar_lote passa NULLIF(...,'') no INSERT em vez de
--    COALESCE com default 'debito'.
-- 4. BACKFILL: UPDATE em movs pendentes com texto de maquininha de
--    debito que estavam marcados 'debito'.
--
-- Resultado em KGF apos backfill: 5 movs CIELO/SICREDI DEBITO agora
-- como 'credito' (entrada). Frontend tela vai oferecer Contas a Receber.
--
-- Aplicada via MCP em 2026-06-15.
-- =============================================================

-- Parte 1: fn_normalizar_natureza_ofx
CREATE OR REPLACE FUNCTION public.fn_normalizar_natureza_ofx(p_descricao text)
RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $function$
DECLARE v_desc text;
BEGIN
  IF p_descricao IS NULL OR TRIM(p_descricao) = '' THEN RETURN 'debito'; END IF;
  v_desc := UPPER(TRIM(p_descricao));

  IF v_desc LIKE 'RECEBIMENTO PIX%' OR v_desc LIKE '%PIX_CRED%' THEN RETURN 'credito'; END IF;
  IF v_desc LIKE '%LIQ.COBRANCA%' OR v_desc LIKE '%LIQUIDACAO COBRANCA%' THEN RETURN 'credito'; END IF;

  -- Maquininha de cartao (credito OU debito = recebimento de venda = entrada)
  IF v_desc LIKE '%CIELO CREDITO%' OR v_desc LIKE '%CIELO DEBITO%'
     OR v_desc LIKE '%SICREDI CREDITO%' OR v_desc LIKE '%SICREDI DEBITO%'
     OR v_desc LIKE '%REDE CREDITO%' OR v_desc LIKE '%REDE DEBITO%'
     OR v_desc LIKE '%STONE CREDITO%' OR v_desc LIKE '%STONE DEBITO%'
     OR v_desc LIKE '%PAGSEGURO CREDITO%' OR v_desc LIKE '%PAGSEGURO DEBITO%'
     OR v_desc LIKE '%MERCADO PAGO CREDITO%' OR v_desc LIKE '%MERCADO PAGO DEBITO%'
     OR v_desc LIKE '%GETNET CREDITO%' OR v_desc LIKE '%GETNET DEBITO%'
     OR v_desc LIKE '%SAFRA CREDITO%' OR v_desc LIKE '%SAFRA DEBITO%' THEN
    RETURN 'credito';
  END IF;

  IF v_desc LIKE 'TED RECEBIDA%' OR v_desc LIKE 'DOC RECEBIDO%'
     OR v_desc LIKE 'CREDITO TED%' OR v_desc LIKE 'CREDITO DOC%' THEN RETURN 'credito'; END IF;
  IF v_desc LIKE 'CRED.%' OR v_desc LIKE 'CRED %' THEN RETURN 'credito'; END IF;
  IF v_desc LIKE 'DEPOSITO%' OR v_desc LIKE 'DEP CHEQUE%' OR v_desc LIKE 'DEP DINHEIRO%' THEN RETURN 'credito'; END IF;
  IF v_desc LIKE 'ESTORNO%' AND v_desc NOT LIKE '%COMPRA%' THEN RETURN 'credito'; END IF;

  IF v_desc LIKE 'PAGAMENTO%' OR v_desc LIKE 'COMPRA%' OR v_desc LIKE 'PIX_DEB%'
     OR v_desc LIKE '%PIX ENVIADO%' OR v_desc LIKE 'TARIFA%' OR v_desc LIKE 'TAXA%'
     OR v_desc LIKE 'DEB.%' OR v_desc LIKE 'DEB %' OR v_desc LIKE '%DEBITO%'
     OR v_desc LIKE 'LIQUIDACAO BOLETO%' OR v_desc LIKE 'BOLETO%'
     OR v_desc LIKE 'IOF%' OR v_desc LIKE 'CESTA DE RELAC%'
     OR v_desc LIKE 'TRIBUTOS%' OR v_desc LIKE 'IMPOSTO%' THEN
    RETURN 'debito';
  END IF;

  RETURN 'debito';
END; $function$;

-- Parte 2: trigger respeita natureza explicita
CREATE OR REPLACE FUNCTION public.fn_conciliacao_movimento_before()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  NEW.descricao := trim(NEW.descricao);
  NEW.descricao_normalizada := fn_normalizar_texto_alerta(NEW.descricao);
  NEW.updated_at := now();

  IF TG_OP = 'INSERT' AND NEW.natureza IS NULL THEN
    NEW.natureza := fn_normalizar_natureza_ofx(NEW.descricao);
  END IF;

  RETURN NEW;
END; $function$;

-- Parte 3: fn_conciliacao_criar_lote passa NULLIF em vez de COALESCE default
CREATE OR REPLACE FUNCTION public.fn_conciliacao_criar_lote(p_company_id uuid, p_tipo text, p_origem text, p_nome text, p_arquivo_nome text, p_arquivo_hash text, p_storage_path text, p_movimentos jsonb, p_periodo_inicio date DEFAULT NULL::date, p_periodo_fim date DEFAULT NULL::date, p_conta_bancaria_id uuid DEFAULT NULL::uuid, p_cartao_id uuid DEFAULT NULL::uuid, p_operadora text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lote_id uuid; v_user_id uuid := auth.uid();
  v_count int := 0; v_total_valor numeric := 0;
  v_existing_lote_id uuid; v_movimento jsonb;
  v_min_data date; v_max_data date; v_tipo_norm text;
BEGIN
  IF p_company_id IS NULL THEN RAISE EXCEPTION 'company_id obrigatorio'; END IF;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Usuario nao autenticado'; END IF;

  v_tipo_norm := CASE lower(COALESCE(p_tipo,''))
    WHEN 'bancario'         THEN 'bancario'
    WHEN 'extrato_bancario' THEN 'bancario'
    WHEN 'cartao_despesa'   THEN 'cartao_despesa'
    WHEN 'fatura_cartao'    THEN 'cartao_despesa'
    WHEN 'cartao_venda'     THEN 'cartao_venda'
    WHEN 'outro'            THEN 'outro'
    ELSE NULL END;
  IF v_tipo_norm IS NULL THEN RAISE EXCEPTION 'tipo invalido: %', p_tipo; END IF;

  IF p_movimentos IS NULL OR jsonb_array_length(p_movimentos) = 0 THEN
    RAISE EXCEPTION 'movimentos vazios - parse OFX falhou';
  END IF;

  IF NOT EXISTS(SELECT 1 FROM user_companies WHERE user_id = v_user_id AND company_id = p_company_id)
     AND NOT is_admin() THEN
    RAISE EXCEPTION 'Sem permissao para essa empresa';
  END IF;

  IF p_arquivo_hash IS NOT NULL THEN
    SELECT id INTO v_existing_lote_id FROM conciliacao_lote
    WHERE company_id = p_company_id AND arquivo_hash = p_arquivo_hash AND status != 'cancelado' LIMIT 1;
    IF v_existing_lote_id IS NOT NULL THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'arquivo_duplicado',
        'mensagem', 'Esse arquivo ja foi importado antes. Lote existente: ' || v_existing_lote_id::text,
        'lote_existente_id', v_existing_lote_id);
    END IF;
  END IF;

  IF p_periodo_inicio IS NULL OR p_periodo_fim IS NULL THEN
    SELECT MIN((m->>'data_transacao')::date), MAX((m->>'data_transacao')::date)
    INTO v_min_data, v_max_data FROM jsonb_array_elements(p_movimentos) m;
  END IF;

  INSERT INTO conciliacao_lote (company_id, tipo, origem, nome, arquivo_nome, arquivo_hash,
    importado_por, periodo_inicio, periodo_fim, conta_bancaria_id, cartao_id, operadora, status)
  VALUES (p_company_id, v_tipo_norm, p_origem, p_nome, p_arquivo_nome, p_arquivo_hash,
    v_user_id, COALESCE(p_periodo_inicio, v_min_data), COALESCE(p_periodo_fim, v_max_data),
    p_conta_bancaria_id, p_cartao_id, p_operadora, 'em_andamento')
  RETURNING id INTO v_lote_id;

  FOR v_movimento IN SELECT * FROM jsonb_array_elements(p_movimentos)
  LOOP
    INSERT INTO conciliacao_movimento (
      lote_id, company_id, data_transacao, valor, descricao,
      natureza, id_externo, documento, parcela,
      adq_bandeira, adq_modalidade, status
    )
    VALUES (
      v_lote_id, p_company_id,
      (v_movimento->>'data_transacao')::date,
      (v_movimento->>'valor')::numeric,
      v_movimento->>'descricao',
      -- FIX-NATUREZA-POR-SINAL-v1: NULLIF em vez de COALESCE com default.
      -- Trigger so preenche se NULL · respeita 'credito'/'debito' do frontend
      -- (que deriva do SINAL do TRNAMT, fonte de verdade).
      NULLIF(v_movimento->>'natureza', ''),
      v_movimento->>'id_externo',
      v_movimento->>'documento',
      v_movimento->>'parcela',
      v_movimento->>'adq_bandeira',
      v_movimento->>'adq_modalidade',
      'pendente'
    );
    v_count := v_count + 1;
    v_total_valor := v_total_valor + (v_movimento->>'valor')::numeric;
  END LOOP;

  UPDATE conciliacao_lote SET total_movimentos = v_count, total_valor = v_total_valor,
    total_pendentes = v_count WHERE id = v_lote_id;

  RETURN jsonb_build_object('sucesso', true, 'lote_id', v_lote_id, 'tipo', v_tipo_norm,
    'total_movimentos', v_count, 'total_valor', v_total_valor,
    'periodo_inicio', COALESCE(p_periodo_inicio, v_min_data),
    'periodo_fim', COALESCE(p_periodo_fim, v_max_data),
    'mensagem', format('Lote criado com %s movimentos. Conciliacao automatica disponivel.', v_count));
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', SQLERRM, 'detalhe', SQLSTATE);
END; $function$;

-- Parte 4: backfill (idempotente: so toca movs pendentes com texto de maquininha de debito marcados 'debito')
UPDATE conciliacao_movimento
SET natureza = 'credito', updated_at = now()
WHERE status = 'pendente' AND natureza = 'debito'
  AND (
    upper(descricao) LIKE '%CIELO DEBITO%'
    OR upper(descricao) LIKE '%SICREDI DEBITO%'
    OR upper(descricao) LIKE '%REDE DEBITO%'
    OR upper(descricao) LIKE '%STONE DEBITO%'
    OR upper(descricao) LIKE '%PAGSEGURO DEBITO%'
    OR upper(descricao) LIKE '%MERCADO PAGO DEBITO%'
    OR upper(descricao) LIKE '%GETNET DEBITO%'
    OR upper(descricao) LIKE '%SAFRA DEBITO%'
  );
