-- PR-FIX empirico (CEO 06/07 pos-#537):
-- (A) Duplicar quebrou em despesa importada do Omie:
--     "duplicate key value violates unique constraint uq_erp_pagar_ref_externa"
--     Causa: copiar ref_externa_id/sistema viola o unique index.
-- (B) Historico GLOBAL (padrao Omie): CEO pediu tela agregada com
--     todas as acoes por company, filtravel por tipo/acao/periodo,
--     export CSV (auditoria BPO). Exclusoes aparecem via snapshot.
-- Aplicada via MCP em 2026-07-06.

-- ==========================================================
-- PARTE A · fn_lancamento_duplicar defensivo contra qualquer unique
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
  v_sql text;
  v_uniques text[];
  v_reset text[] := ARRAY[
    'id','created_at','updated_at',
    'descricao','valor_pago','data_pagamento','data_emissao','data_vencimento','status',
    'conciliado','movimento_banco_id','forma_pagamento',
    'boleto_status','boleto_nosso_numero','boleto_linha_digitavel','boleto_qr_code','boleto_url',
    -- Importacoes externas (Omie/ContaAzul/etc) — NAO herdam na copia
    'ref_externa_id','ref_externa_sistema','import_hash','importado_em','importado_por',
    'numero_documento'
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

  -- AUTO-detecta colunas em unique constraint da tabela e adiciona ao reset.
  SELECT coalesce(array_agg(DISTINCT a.attname), ARRAY[]::text[])
    INTO v_uniques
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
   WHERE n.nspname = 'public'
     AND rel.relname = v_tabela
     AND c.contype IN ('u','p','x')
     AND a.attname NOT IN ('id','company_id');
  v_reset := v_reset || v_uniques;

  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_col_list
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name=v_tabela
     AND column_name <> ALL(v_reset);

  v_sql := format(
    'INSERT INTO %I (%s, descricao, valor_pago, data_emissao, data_vencimento, status, conciliado) ' ||
    'SELECT %s, descricao || '' (cópia)'', 0, %L, %L, ''aberto'', false ' ||
    'FROM %I WHERE id = $1 RETURNING id',
    v_tabela, v_col_list, v_col_list, v_hoje, v_hoje, v_tabela
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

-- ==========================================================
-- PARTE B · fn_lancamento_historico_global — timeline agregada da empresa
CREATE OR REPLACE FUNCTION public.fn_lancamento_historico_global(
  p_company_id  uuid,
  p_tipo        text DEFAULT 'todos',
  p_acao        text DEFAULT 'todas',
  p_data_inicio date DEFAULT NULL,
  p_data_fim    date DEFAULT NULL,
  p_limite      integer DEFAULT 500
)
RETURNS TABLE (
  log_id           uuid,
  data_evento      timestamptz,
  user_email       text,
  acao             text,
  tabela_origem    text,
  lancamento_id    uuid,
  descricao        text,
  valor            numeric,
  nome_pessoa      text,
  campos_alterados jsonb
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'acesso_negado';
  END IF;

  RETURN QUERY
  WITH filtrado AS (
    SELECT l.id, l.lancamento_id, l.user_email, l.acao, l.campos_alterados,
           l.tabela_origem, l.created_at
    FROM public.erp_lancamento_log l
    WHERE (p_data_inicio IS NULL OR l.created_at >= p_data_inicio)
      AND (p_data_fim    IS NULL OR l.created_at <  (p_data_fim + interval '1 day'))
      AND (p_acao = 'todas' OR l.acao = p_acao)
      AND (p_tipo = 'todos' OR l.tabela_origem = 'erp_' || p_tipo)
  )
  SELECT f.id, f.created_at, f.user_email, f.acao, f.tabela_origem,
         f.lancamento_id, p.descricao, p.valor, p.fornecedor_nome AS nome_pessoa,
         f.campos_alterados
  FROM filtrado f
  JOIN public.erp_pagar p ON p.id = f.lancamento_id AND p.company_id = p_company_id
  WHERE f.tabela_origem = 'erp_pagar' AND f.acao <> 'EXCLUIU'

  UNION ALL

  SELECT f.id, f.created_at, f.user_email, f.acao, f.tabela_origem,
         f.lancamento_id, r.descricao, r.valor, r.cliente_nome AS nome_pessoa,
         f.campos_alterados
  FROM filtrado f
  JOIN public.erp_receber r ON r.id = f.lancamento_id AND r.company_id = p_company_id
  WHERE f.tabela_origem = 'erp_receber' AND f.acao <> 'EXCLUIU'

  UNION ALL

  SELECT f.id, f.created_at, f.user_email, f.acao, f.tabela_origem,
         f.lancamento_id,
         (f.campos_alterados->'registro'->>'descricao')::text AS descricao,
         nullif(f.campos_alterados->'registro'->>'valor','')::numeric AS valor,
         coalesce(
           f.campos_alterados->'registro'->>'fornecedor_nome',
           f.campos_alterados->'registro'->>'cliente_nome',
           f.campos_alterados->'registro'->>'nome_pessoa'
         ) AS nome_pessoa,
         f.campos_alterados
  FROM filtrado f
  WHERE f.acao = 'EXCLUIU'
    AND (f.campos_alterados->'registro'->>'company_id')::uuid = p_company_id

  ORDER BY data_evento DESC
  LIMIT p_limite;
END $$;

GRANT EXECUTE ON FUNCTION public.fn_lancamento_historico_global(uuid, text, text, date, date, integer)
  TO authenticated, service_role;
