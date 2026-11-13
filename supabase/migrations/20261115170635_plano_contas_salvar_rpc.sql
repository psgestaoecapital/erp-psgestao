-- fn_plano_contas_salvar: writer guardado para criar/editar conta do Plano de Contas.
-- PDCA GE /dashboard/cadastros/plano-contas (aud8 92/95):
--   critério (e) — erro cru do banco ao salvar código duplicado (unique uq_erp_plano_contas_codigo)
--   RD-98 p4 — criar/editar iam DIRETO na tabela sem audit_log (só o toggle auditava).
-- Esta RPC centraliza validação (código único com mensagem amigável), RLS/multi-tenant
-- e grava audit_log_global (acao plano_conta_criar/plano_conta_editar).
-- Aditiva: não altera a tabela nem dado de cliente; apenas adiciona a função.

CREATE OR REPLACE FUNCTION public.fn_plano_contas_salvar(
  p_id             uuid,
  p_company_id     uuid,
  p_codigo         text,
  p_descricao      text,
  p_tipo           text,
  p_grupo          text,
  p_pai_codigo     text DEFAULT NULL,
  p_nivel          integer DEFAULT 2,
  p_is_totalizador boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_codigo    text := NULLIF(btrim(p_codigo), '');
  v_descricao text := NULLIF(btrim(p_descricao), '');
  v_pai       text := NULLIF(btrim(p_pai_codigo), '');
  v_nivel     integer := COALESCE(p_nivel, 2);
  v_existe    public.erp_plano_contas%ROWTYPE;
  v_id        uuid;
  v_antes     jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado');
  END IF;
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'empresa_obrigatoria');
  END IF;
  IF v_codigo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'codigo_obrigatorio', 'mensagem', 'Informe o código da conta.');
  END IF;
  IF v_descricao IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'descricao_obrigatoria', 'mensagem', 'Informe a descrição da conta.');
  END IF;
  IF NULLIF(btrim(p_grupo), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'grupo_obrigatorio', 'mensagem', 'Selecione o grupo DRE da conta.');
  END IF;
  IF NULLIF(btrim(p_tipo), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tipo_obrigatorio', 'mensagem', 'Selecione o tipo da conta.');
  END IF;

  -- Guarda multi-tenant: só grava em empresa no escopo do usuário (ou admin).
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso', 'mensagem', 'Você não tem acesso a esta empresa.');
  END IF;

  -- Edição: a conta tem de existir e ser da mesma empresa (nunca template global).
  IF p_id IS NOT NULL THEN
    SELECT * INTO v_existe FROM public.erp_plano_contas WHERE id = p_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado', 'mensagem', 'Conta não encontrada.');
    END IF;
    IF v_existe.company_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'conta_global_nao_editavel', 'mensagem', 'Contas do modelo padrão não podem ser editadas.');
    END IF;
    IF v_existe.company_id <> p_company_id THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'empresa_divergente', 'mensagem', 'A conta pertence a outra empresa.');
    END IF;
  END IF;

  -- Código único por empresa, com mensagem amigável (em vez do erro cru do índice).
  IF EXISTS (
    SELECT 1 FROM public.erp_plano_contas
    WHERE company_id = p_company_id
      AND codigo = v_codigo
      AND (p_id IS NULL OR id <> p_id)
  ) THEN
    RETURN jsonb_build_object(
      'ok', false, 'erro', 'codigo_duplicado',
      'mensagem', 'Já existe uma conta com o código ' || v_codigo || ' neste plano.'
    );
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.erp_plano_contas
      (company_id, codigo, descricao, tipo, grupo, pai_codigo, nivel, ativo, is_totalizador)
    VALUES
      (p_company_id, v_codigo, v_descricao, p_tipo, p_grupo, v_pai, v_nivel, true, COALESCE(p_is_totalizador, false))
    RETURNING id INTO v_id;

    INSERT INTO public.audit_log_global
      (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES
      (p_company_id, v_uid, COALESCE((SELECT email FROM public.users WHERE id = v_uid), ''),
       'erp_plano_contas', v_id::text, 'plano_conta_criar', NULL,
       jsonb_build_object('codigo', v_codigo, 'descricao', v_descricao, 'tipo', p_tipo, 'grupo', p_grupo,
                          'pai_codigo', v_pai, 'nivel', v_nivel, 'is_totalizador', COALESCE(p_is_totalizador, false)));
  ELSE
    v_antes := jsonb_build_object('codigo', v_existe.codigo, 'descricao', v_existe.descricao, 'tipo', v_existe.tipo,
                                  'grupo', v_existe.grupo, 'pai_codigo', v_existe.pai_codigo, 'nivel', v_existe.nivel,
                                  'is_totalizador', v_existe.is_totalizador);
    v_id := p_id;

    UPDATE public.erp_plano_contas
       SET codigo = v_codigo,
           descricao = v_descricao,
           tipo = p_tipo,
           grupo = p_grupo,
           pai_codigo = v_pai,
           nivel = v_nivel,
           is_totalizador = COALESCE(p_is_totalizador, false)
     WHERE id = p_id;

    INSERT INTO public.audit_log_global
      (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES
      (p_company_id, v_uid, COALESCE((SELECT email FROM public.users WHERE id = v_uid), ''),
       'erp_plano_contas', v_id::text, 'plano_conta_editar', v_antes,
       jsonb_build_object('codigo', v_codigo, 'descricao', v_descricao, 'tipo', p_tipo, 'grupo', p_grupo,
                          'pai_codigo', v_pai, 'nivel', v_nivel, 'is_totalizador', COALESCE(p_is_totalizador, false)));
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'codigo', v_codigo);
END $function$;

REVOKE ALL ON FUNCTION public.fn_plano_contas_salvar(uuid, uuid, text, text, text, text, text, integer, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_contas_salvar(uuid, uuid, text, text, text, text, text, integer, boolean) TO authenticated;
