-- Diretriz CEO 06/07 · #535 followup: Editar/Excluir/Duplicar de pagar/receber
-- passam a gravar auditoria em erp_lancamento_log (imutavel). RD-30: nao cria
-- nem altera a tabela erp_lancamento_log; só cria as RPCs canonicas.
--
-- Assinatura de erp_lancamento_log confiada ao briefing: id uuid, lancamento_id uuid,
-- user_email text, acao text, campos_alterados jsonb, created_at timestamptz.
-- Coluna 'tabela' NAO existe → distincao pagar/receber vai dentro do jsonb.

-- ────────────────────────────────────────────────────────────
-- helper: user_email do JWT (ou do auth.users). Se ambos vazios, grava NULL.
CREATE OR REPLACE FUNCTION public.fn_user_email_atual()
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE v_email text;
BEGIN
  v_email := coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (SELECT email FROM auth.users WHERE id = auth.uid())
  );
  RETURN v_email;
END $$;

REVOKE ALL ON FUNCTION public.fn_user_email_atual() FROM public;
GRANT EXECUTE ON FUNCTION public.fn_user_email_atual() TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- fn_pagar_editar — altera descricao/valor/data_vencimento/numero_documento
-- + grava snapshot antes/depois em erp_lancamento_log.
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

  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados)
  VALUES (p_id, v_email, 'EDITOU', jsonb_build_object(
    'tabela', 'erp_pagar',
    'antes', v_antes,
    'depois', v_depois
  ));

  RETURN jsonb_build_object('sucesso', true, 'id', p_id);
END $$;

-- ────────────────────────────────────────────────────────────
-- fn_receber_editar — espelho de fn_pagar_editar em erp_receber
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

  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados)
  VALUES (p_id, v_email, 'EDITOU', jsonb_build_object(
    'tabela', 'erp_receber',
    'antes', v_antes,
    'depois', v_depois
  ));

  RETURN jsonb_build_object('sucesso', true, 'id', p_id);
END $$;

-- ────────────────────────────────────────────────────────────
-- fn_pagar_excluir — bloqueia se conciliado/pago, grava snapshot ANTES do delete.
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

  -- Grava snapshot ANTES do delete (senao perde).
  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados)
  VALUES (p_id, v_email, 'EXCLUIU', jsonb_build_object(
    'tabela', 'erp_pagar',
    'registro', v_registro
  ));

  DELETE FROM public.erp_pagar WHERE id = p_id;

  RETURN jsonb_build_object('sucesso', true, 'id', p_id);
END $$;

-- ────────────────────────────────────────────────────────────
-- fn_receber_excluir — espelho
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

  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados)
  VALUES (p_id, v_email, 'EXCLUIU', jsonb_build_object(
    'tabela', 'erp_receber',
    'registro', v_registro
  ));

  DELETE FROM public.erp_receber WHERE id = p_id;

  RETURN jsonb_build_object('sucesso', true, 'id', p_id);
END $$;

-- ────────────────────────────────────────────────────────────
-- fn_lancamento_duplicar — cria copia como 'aberto', grava origem+nova no log.
CREATE OR REPLACE FUNCTION public.fn_lancamento_duplicar(p_tipo text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_origem jsonb;
  v_novo_id uuid;
  v_company_id uuid;
  v_email text := public.fn_user_email_atual();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF p_tipo NOT IN ('pagar','receber') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'tipo_invalido');
  END IF;

  IF p_tipo = 'pagar' THEN
    SELECT to_jsonb(p.*), p.company_id INTO v_origem, v_company_id
    FROM public.erp_pagar p WHERE p.id = p_id;
  ELSE
    SELECT to_jsonb(r.*), r.company_id INTO v_origem, v_company_id
    FROM public.erp_receber r WHERE r.id = p_id;
  END IF;

  IF v_origem IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado');
  END IF;
  IF NOT (v_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;

  IF p_tipo = 'pagar' THEN
    INSERT INTO public.erp_pagar (
      company_id, descricao, valor, valor_pago, data_emissao, data_vencimento,
      status, categoria, nome_pessoa, numero_documento, parcela, conciliado, movimento_banco_id
    )
    SELECT
      company_id, descricao || ' (cópia)', valor, 0,
      v_hoje, v_hoje, 'aberto', categoria, nome_pessoa, numero_documento, parcela,
      false, NULL
    FROM public.erp_pagar WHERE id = p_id
    RETURNING id INTO v_novo_id;
  ELSE
    INSERT INTO public.erp_receber (
      company_id, descricao, valor, valor_pago, data_emissao, data_vencimento,
      status, categoria, nome_pessoa, numero_documento, parcela, conciliado, movimento_banco_id
    )
    SELECT
      company_id, descricao || ' (cópia)', valor, 0,
      v_hoje, v_hoje, 'aberto', categoria, nome_pessoa, numero_documento, parcela,
      false, NULL
    FROM public.erp_receber WHERE id = p_id
    RETURNING id INTO v_novo_id;
  END IF;

  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados)
  VALUES (v_novo_id, v_email, 'DUPLICOU', jsonb_build_object(
    'tabela', 'erp_' || p_tipo,
    'origem_id', p_id,
    'novo_id', v_novo_id
  ));
  -- Grava tambem no id_original para o timeline mostrar "foi duplicada"
  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados)
  VALUES (p_id, v_email, 'ORIGEM_DUPLICADA', jsonb_build_object(
    'tabela', 'erp_' || p_tipo,
    'novo_id', v_novo_id
  ));

  RETURN jsonb_build_object('sucesso', true, 'id', v_novo_id);
END $$;

-- ────────────────────────────────────────────────────────────
-- fn_lancamento_historico — timeline read-only (RLS ja cobre pela tabela pai).
CREATE OR REPLACE FUNCTION public.fn_lancamento_historico(p_id uuid)
RETURNS TABLE (
  id uuid, user_email text, acao text, campos_alterados jsonb, created_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id, user_email, acao, campos_alterados, created_at
  FROM public.erp_lancamento_log
  WHERE lancamento_id = p_id
  ORDER BY created_at DESC
  LIMIT 200;
$$;

-- ────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.fn_pagar_editar(uuid, text, numeric, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_receber_editar(uuid, text, numeric, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_pagar_excluir(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_receber_excluir(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_lancamento_duplicar(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_lancamento_historico(uuid) TO authenticated, service_role;
