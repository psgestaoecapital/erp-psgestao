-- EHS · M11 · /dashboard/ehs/trabalhos-risco/permissoes · RD-98 p3/p4 (CRUD via RPC + sem DELETE físico)
-- Code: desenvolvedor_5_g
--
-- Problema (auditor_pdca_1, provado no código vivo de origin/main — RD-38):
--   A tela de Permissão de Trabalho (PT) escrevia DIRETO nas tabelas pelo cliente, sem RPC/guarda/audit:
--     • DELETE FÍSICO de ehs_pt_medida a cada edição (apaga a prova de que o risco foi tratado);
--     • INSERT/UPDATE/desativar de PT direto na tabela;
--     • system_screens da rota com rpcs_chamadas/views_consumidas = NULL (origem do dado não registrada).
--   As irmãs (APR/incidentes/DDS/mudanças/inspeções/brigada) já foram para RPC com soft-delete; a PT ficou fora.
--
-- Correção (replica o padrão proven em DB — fn_ehs_posto_epi_remover / fn_ehs_maquina_salvar):
--   • fn_ehs_pt_salvar: cria/edita a PT e as medidas; as medidas removidas viram SOFT-DELETE (ativo=false),
--     NUNCA DELETE físico; guarda por empresa (fn_compliance_assert); grava audit_log_global.
--   • fn_ehs_pt_desativar: soft-delete da PT (ativo=false) com motivo + audit_log_global.
--   • system_screens: registra a origem do dado desta rota.
--
-- Aditivo e idempotente (CREATE OR REPLACE; nenhum DROP/DELETE/UPDATE em massa). RLS inalterada.

-- ───────────────────────────────────────────────────────────────────────────────────────────
-- fn_ehs_pt_salvar — criar/editar PT + medidas (soft-delete das removidas)
-- p_dados: { numero, tipo, titulo, descricao, local, setor, data_inicio, data_fim,
--            responsavel_emissao, executantes, status, observacoes }
-- p_medidas: [ { id?, descricao, atendido, ordem } ]
-- ───────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ehs_pt_salvar(
  p_company_id uuid,
  p_id         uuid,
  p_dados      jsonb,
  p_medidas    jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid      uuid := auth.uid();
  v_company  uuid;
  v_pt_id    uuid;
  v_titulo   text := btrim(COALESCE(p_dados->>'titulo',''));
  v_di       timestamptz := NULLIF(p_dados->>'data_inicio','')::timestamptz;
  v_df       timestamptz := NULLIF(p_dados->>'data_fim','')::timestamptz;
  v_keep_ids uuid[];
  v_removidas int := 0;
  v_salvas    int := 0;
  v_acao     text;
  m          jsonb;
  v_mid      uuid;
BEGIN
  IF v_titulo = '' THEN RAISE EXCEPTION 'titulo_obrigatorio'; END IF;
  IF v_di IS NOT NULL AND v_df IS NOT NULL AND v_df < v_di THEN RAISE EXCEPTION 'periodo_invalido'; END IF;

  IF p_id IS NULL THEN
    PERFORM public.fn_compliance_assert(p_company_id);
    v_company := p_company_id;
    INSERT INTO public.ehs_permissao_trabalho(
      company_id, numero, tipo, titulo, descricao, local, setor,
      data_inicio, data_fim, responsavel_emissao, executantes, status, observacoes, criado_por)
    VALUES (
      v_company,
      NULLIF(btrim(p_dados->>'numero'),''),
      COALESCE(NULLIF(p_dados->>'tipo',''),'geral'),
      v_titulo,
      NULLIF(btrim(p_dados->>'descricao'),''),
      NULLIF(btrim(p_dados->>'local'),''),
      NULLIF(btrim(p_dados->>'setor'),''),
      v_di, v_df,
      NULLIF(btrim(p_dados->>'responsavel_emissao'),''),
      NULLIF(btrim(p_dados->>'executantes'),''),
      COALESCE(NULLIF(p_dados->>'status',''),'rascunho'),
      NULLIF(btrim(p_dados->>'observacoes'),''),
      v_uid)
    RETURNING id INTO v_pt_id;
    v_acao := 'ehs_pt_criar';
  ELSE
    -- editar: a empresa é a do PT existente (não permite migrar PT entre empresas)
    SELECT company_id INTO v_company FROM public.ehs_permissao_trabalho WHERE id = p_id;
    IF v_company IS NULL THEN RAISE EXCEPTION 'pt_invalida'; END IF;
    PERFORM public.fn_compliance_assert(v_company);
    UPDATE public.ehs_permissao_trabalho SET
      numero              = NULLIF(btrim(p_dados->>'numero'),''),
      tipo                = COALESCE(NULLIF(p_dados->>'tipo',''),'geral'),
      titulo              = v_titulo,
      descricao           = NULLIF(btrim(p_dados->>'descricao'),''),
      local               = NULLIF(btrim(p_dados->>'local'),''),
      setor               = NULLIF(btrim(p_dados->>'setor'),''),
      data_inicio         = v_di,
      data_fim            = v_df,
      responsavel_emissao = NULLIF(btrim(p_dados->>'responsavel_emissao'),''),
      executantes         = NULLIF(btrim(p_dados->>'executantes'),''),
      status              = COALESCE(NULLIF(p_dados->>'status',''),'rascunho'),
      observacoes         = NULLIF(btrim(p_dados->>'observacoes'),''),
      atualizado_em       = now()
    WHERE id = p_id AND company_id = v_company;
    v_pt_id := p_id;
    v_acao := 'ehs_pt_editar';
  END IF;

  -- medidas a preservar: as que vieram com id
  SELECT COALESCE(array_agg((e->>'id')::uuid), ARRAY[]::uuid[])
    INTO v_keep_ids
    FROM jsonb_array_elements(COALESCE(p_medidas,'[]'::jsonb)) e
   WHERE NULLIF(e->>'id','') IS NOT NULL;

  -- SOFT-DELETE (nunca DELETE físico) das medidas ativas que saíram do conjunto
  UPDATE public.ehs_pt_medida
     SET ativo = false
   WHERE pt_id = v_pt_id AND ativo = true AND NOT (id = ANY (v_keep_ids));
  GET DIAGNOSTICS v_removidas = ROW_COUNT;

  -- upsert das medidas informadas (ignora descrição vazia)
  FOR m IN SELECT * FROM jsonb_array_elements(COALESCE(p_medidas,'[]'::jsonb))
  LOOP
    IF COALESCE(btrim(m->>'descricao'),'') = '' THEN CONTINUE; END IF;
    v_mid := NULLIF(m->>'id','')::uuid;
    IF v_mid IS NOT NULL THEN
      UPDATE public.ehs_pt_medida
         SET descricao = btrim(m->>'descricao'),
             atendido  = COALESCE((m->>'atendido')::boolean, false),
             ordem     = COALESCE((m->>'ordem')::int, 1),
             ativo     = true
       WHERE id = v_mid AND pt_id = v_pt_id AND company_id = v_company;
    ELSE
      INSERT INTO public.ehs_pt_medida(company_id, pt_id, ordem, descricao, atendido, ativo)
      VALUES (v_company, v_pt_id, COALESCE((m->>'ordem')::int, 1),
              btrim(m->>'descricao'), COALESCE((m->>'atendido')::boolean, false), true);
    END IF;
    v_salvas := v_salvas + 1;
  END LOOP;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_company, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'ehs_permissao_trabalho', v_pt_id::text, v_acao, NULL,
          jsonb_build_object('titulo', v_titulo, 'medidas_salvas', v_salvas, 'medidas_removidas', v_removidas));

  RETURN jsonb_build_object('ok', true, 'pt_id', v_pt_id,
                            'medidas_salvas', v_salvas, 'medidas_removidas', v_removidas);
END $fn$;

-- ───────────────────────────────────────────────────────────────────────────────────────────
-- fn_ehs_pt_desativar — soft-delete da PT com motivo + audit
-- ───────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ehs_pt_desativar(
  p_id     uuid,
  p_motivo text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_r   public.ehs_permissao_trabalho%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM public.ehs_permissao_trabalho WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Permissão não encontrada'); END IF;
  IF NOT (v_r.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta permissão'); END IF;
  IF COALESCE(btrim(p_motivo),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o motivo da desativação'); END IF;
  IF v_r.ativo = false THEN RETURN jsonb_build_object('ok', true, 'ja_desativada', true); END IF;

  UPDATE public.ehs_permissao_trabalho
     SET ativo         = false,
         observacoes   = left(COALESCE(observacoes || ' ', '') || '[desativada: ' || btrim(p_motivo) || ']', 2000),
         atualizado_em = now()
   WHERE id = p_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_r.company_id, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'ehs_permissao_trabalho', p_id::text, 'ehs_pt_desativar',
          jsonb_build_object('titulo', v_r.titulo, 'status', v_r.status, 'ativo', v_r.ativo),
          jsonb_build_object('ativo', false, 'motivo', btrim(p_motivo), 'desativado_por', v_uid));

  RETURN jsonb_build_object('ok', true);
END $fn$;

-- Acesso: só usuário logado (nunca anon); a guarda por empresa é interna às funções.
REVOKE ALL ON FUNCTION public.fn_ehs_pt_salvar(uuid, uuid, jsonb, jsonb) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.fn_ehs_pt_salvar(uuid, uuid, jsonb, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_ehs_pt_desativar(uuid, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.fn_ehs_pt_desativar(uuid, text) TO authenticated;

-- Origem do dado da rota (RD-98 p3)
UPDATE public.system_screens
   SET rpcs_chamadas    = ARRAY['fn_ehs_pt_salvar','fn_ehs_pt_desativar'],
       views_consumidas = ARRAY['ehs_permissao_trabalho','ehs_pt_medida']
 WHERE rota = '/dashboard/ehs/trabalhos-risco/permissoes';
