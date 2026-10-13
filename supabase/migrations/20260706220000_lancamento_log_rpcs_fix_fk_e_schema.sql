-- PR-FIX ao PR #536: 3 bugs empiricos capturados em prod (05/07 Jordana/CEO):
-- (1) FK erp_lancamento_log_lancamento_id_fkey RIGIDA -> quebra edit e delete
--     (log polimorfico serve pagar+receber; delete apaga o FK-target)
-- (2) fn_lancamento_duplicar referencia coluna 'nome_pessoa' que NAO existe
--     em erp_pagar (esta 'fornecedor_nome' segundo o SPEC do CEO)
-- (3) idem em erp_receber pode ter outros nomes (cliente_nome?)
--
-- Solucao: FK cai (audit log NUNCA tem FK pro target), adiciona tabela_origem,
-- e fn_lancamento_duplicar passa a usar SQL DINAMICO via information_schema
-- (copia colunas que EXISTEM em runtime, imune a nomes especificos ou schema drift).
-- Aplicada via MCP em 2026-07-06.

-- ==========================================================
-- PASSO 1 · Remove FK (RD-30: nao dropa a tabela, so a constraint)
ALTER TABLE public.erp_lancamento_log
  DROP CONSTRAINT IF EXISTS erp_lancamento_log_lancamento_id_fkey;

-- Novo campo para distinguir pagar vs receber
ALTER TABLE public.erp_lancamento_log
  ADD COLUMN IF NOT EXISTS tabela_origem text;

-- ==========================================================
-- PASSO 2 · Verificar colunas MINIMAS em pagar e receber (fail-fast)
DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(col, ', ') INTO v_missing FROM (
    SELECT unnest(ARRAY['id','company_id','descricao','valor','valor_pago','status','conciliado','data_vencimento','data_emissao']) AS col
    EXCEPT
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='erp_pagar'
  ) x;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'erp_pagar sem colunas obrigatorias: %', v_missing;
  END IF;

  SELECT string_agg(col, ', ') INTO v_missing FROM (
    SELECT unnest(ARRAY['id','company_id','descricao','valor','valor_pago','status','conciliado','data_vencimento','data_emissao']) AS col
    EXCEPT
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='erp_receber'
  ) x;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'erp_receber sem colunas obrigatorias: %', v_missing;
  END IF;
END $$;

-- ==========================================================
-- PASSO 3 · Editar (recria com tabela_origem no log)
CREATE OR REPLACE FUNCTION public.fn_pagar_editar(
  p_id                uuid,
  p_descricao         text,
  p_valor             numeric,
  p_data_vencimento   date,
  p_numero_documento  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_antes  jsonb;
  v_depois jsonb;
  v_email  text := public.fn_user_email_atual();
  v_company_id uuid;
BEGIN
  SELECT to_jsonb(p.*), p.company_id INTO v_antes, v_company_id
  FROM public.erp_pagar p WHERE p.id = p_id;

  IF v_antes IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado');
  END IF;
  IF NOT (v_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;

  UPDATE public.erp_pagar SET
    descricao        = coalesce(p_descricao, descricao),
    valor            = coalesce(p_valor, valor),
    data_vencimento  = coalesce(p_data_vencimento, data_vencimento),
    numero_documento = coalesce(p_numero_documento, numero_documento),
    updated_at       = now()
  WHERE id = p_id;

  SELECT to_jsonb(p.*) INTO v_depois FROM public.erp_pagar p WHERE p.id = p_id;

  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
  VALUES (p_id, v_email, 'EDITOU', jsonb_build_object(
    'antes', v_antes, 'depois', v_depois
  ), 'erp_pagar');

  RETURN jsonb_build_object('sucesso', true, 'id', p_id);
END $$;

CREATE OR REPLACE FUNCTION public.fn_receber_editar(
  p_id                uuid,
  p_descricao         text,
  p_valor             numeric,
  p_data_vencimento   date,
  p_numero_documento  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_antes  jsonb;
  v_depois jsonb;
  v_email  text := public.fn_user_email_atual();
  v_company_id uuid;
BEGIN
  SELECT to_jsonb(r.*), r.company_id INTO v_antes, v_company_id
  FROM public.erp_receber r WHERE r.id = p_id;

  IF v_antes IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado');
  END IF;
  IF NOT (v_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;

  UPDATE public.erp_receber SET
    descricao        = coalesce(p_descricao, descricao),
    valor            = coalesce(p_valor, valor),
    data_vencimento  = coalesce(p_data_vencimento, data_vencimento),
    numero_documento = coalesce(p_numero_documento, numero_documento),
    updated_at       = now()
  WHERE id = p_id;

  SELECT to_jsonb(r.*) INTO v_depois FROM public.erp_receber r WHERE r.id = p_id;

  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
  VALUES (p_id, v_email, 'EDITOU', jsonb_build_object(
    'antes', v_antes, 'depois', v_depois
  ), 'erp_receber');

  RETURN jsonb_build_object('sucesso', true, 'id', p_id);
END $$;

-- ==========================================================
-- PASSO 4 · Excluir (guarda-rail + snapshot antes)
CREATE OR REPLACE FUNCTION public.fn_pagar_excluir(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_registro jsonb;
  v_status text; v_conciliado boolean; v_company_id uuid;
  v_email text := public.fn_user_email_atual();
BEGIN
  SELECT to_jsonb(p.*), p.status, p.conciliado, p.company_id
    INTO v_registro, v_status, v_conciliado, v_company_id
  FROM public.erp_pagar p WHERE p.id = p_id;

  IF v_registro IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado');
  END IF;
  IF NOT (v_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;
  IF v_status = 'pago' OR v_conciliado THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'bloqueado_conciliado_ou_pago',
      'orientacao', 'Desvincule no inbox de conciliação antes de excluir.');
  END IF;

  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
  VALUES (p_id, v_email, 'EXCLUIU', jsonb_build_object('registro', v_registro), 'erp_pagar');

  DELETE FROM public.erp_pagar WHERE id = p_id;

  RETURN jsonb_build_object('sucesso', true, 'id', p_id);
END $$;

CREATE OR REPLACE FUNCTION public.fn_receber_excluir(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_registro jsonb;
  v_status text; v_conciliado boolean; v_company_id uuid;
  v_email text := public.fn_user_email_atual();
BEGIN
  SELECT to_jsonb(r.*), r.status, r.conciliado, r.company_id
    INTO v_registro, v_status, v_conciliado, v_company_id
  FROM public.erp_receber r WHERE r.id = p_id;

  IF v_registro IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado');
  END IF;
  IF NOT (v_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;
  IF v_status = 'pago' OR v_conciliado THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'bloqueado_conciliado_ou_pago',
      'orientacao', 'Desvincule no inbox de conciliação antes de excluir.');
  END IF;

  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
  VALUES (p_id, v_email, 'EXCLUIU', jsonb_build_object('registro', v_registro), 'erp_receber');

  DELETE FROM public.erp_receber WHERE id = p_id;

  RETURN jsonb_build_object('sucesso', true, 'id', p_id);
END $$;

-- ==========================================================
-- PASSO 5 · Duplicar DINAMICO (imune a schema drift)
CREATE OR REPLACE FUNCTION public.fn_lancamento_duplicar(p_tipo text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tabela text;
  v_novo_id uuid;
  v_company_id uuid;
  v_email text := public.fn_user_email_atual();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_col_list text;
  v_select_list text;
  v_sql text;
  v_reset text[] := ARRAY[
    'id','created_at','updated_at',
    'descricao','valor_pago','data_pagamento','data_emissao','data_vencimento','status',
    'conciliado','movimento_banco_id','forma_pagamento',
    'boleto_status','boleto_nosso_numero','boleto_linha_digitavel','boleto_qr_code','boleto_url'
  ];
BEGIN
  IF p_tipo NOT IN ('pagar','receber') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'tipo_invalido');
  END IF;
  v_tabela := 'erp_' || p_tipo;

  EXECUTE format('SELECT company_id FROM %I WHERE id=$1', v_tabela)
    INTO v_company_id USING p_id;
  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado');
  END IF;
  IF NOT (v_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;

  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_col_list
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name=v_tabela
     AND column_name <> ALL(v_reset);
  v_select_list := v_col_list;

  v_sql := format(
    'INSERT INTO %I (%s, descricao, valor_pago, data_emissao, data_vencimento, status, conciliado) ' ||
    'SELECT %s, descricao || '' (cópia)'', 0, %L, %L, ''aberto'', false ' ||
    'FROM %I WHERE id = $1 RETURNING id',
    v_tabela, v_col_list, v_select_list, v_hoje, v_hoje, v_tabela
  );
  EXECUTE v_sql INTO v_novo_id USING p_id;

  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
  VALUES (v_novo_id, v_email, 'DUPLICOU',
    jsonb_build_object('origem_id', p_id, 'novo_id', v_novo_id),
    v_tabela);
  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
  VALUES (p_id, v_email, 'ORIGEM_DUPLICADA',
    jsonb_build_object('novo_id', v_novo_id),
    v_tabela);

  RETURN jsonb_build_object('sucesso', true, 'id', v_novo_id);
END $$;
