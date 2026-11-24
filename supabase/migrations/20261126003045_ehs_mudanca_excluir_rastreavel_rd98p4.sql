-- PS EHS · EHS-7 / M11 Gestão de mudanças (MOC) (/dashboard/ehs/trabalhos-risco/mudancas)
-- PDCA auditor_pdca_1 (23/11, DEMO EHS b0700000-...-000b) — RD-98 p4 (exclusão rastreável) + p3 (origem do dado).
--
-- BLOQUEADOR (gap 1): a análise de mudança (MOC) é documento de segurança; quem desativa/edita tem peso.
--   HOJE a tela desativava a mudança com UPDATE ativo=false + texto em observacoes, SEM gravar quem/quando numa
--   coluna própria e SEM audit_log; e ao editar APAGAVA FISICAMENTE as ações de controle
--   (ehs_mudanca_acao.delete). Fecha espelhando fn_ehs_pt_desativar/fn_ehs_pt_medidas_salvar (migration
--   20261125220045, PR #5988, RD-98 p4) e fn_epi_excluir (20261124061545):
--     * ehs_mudanca e ehs_mudanca_acao ganham excluido_em/excluido_por (rastro; soft-delete por ativo=false);
--     * fn_ehs_mudanca_desativar: soft-delete da mudança com quem/quando/motivo + registro em audit_log_global;
--     * fn_ehs_mudanca_acoes_salvar: reescreve a coleção de ações por SOFT-DELETE (ativo=false) + insert, com
--       audit — acaba o DELETE físico; a página passa a chamar esta RPC em vez de delete()+insert().
-- Origem do dado (gap 3): system_screens da rota ganha views_consumidas/rpcs_chamadas e estado_real='pronto'.
--
-- ADITIVA e idempotente (ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, UPDATE idempotente). Sem DROP/TRUNCATE
-- e sem UPDATE em massa de dado de cliente. Dado de segurança → via revisada (revisao-eng-chefe). Guarda por
-- empresa mantida (get_user_company_ids()/is_admin()). Code: desenvolvedor_5_g

-- 1) Colunas de rastro de exclusão (RD-98 p4) ─────────────────────────────────────────────────────────
ALTER TABLE public.ehs_mudanca      ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ehs_mudanca      ADD COLUMN IF NOT EXISTS excluido_por uuid;
ALTER TABLE public.ehs_mudanca_acao ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ehs_mudanca_acao ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- 2) Desativação rastreável da mudança ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ehs_mudanca_desativar(p_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_co     uuid;
  v_titulo text;
  v_obs    text;
  v_achou  boolean := false;
BEGIN
  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o motivo para desativar.');
  END IF;

  SELECT true, company_id, titulo, observacoes
    INTO v_achou, v_co, v_titulo, v_obs
  FROM ehs_mudanca WHERE id = p_id;
  IF NOT v_achou THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Mudança não encontrada'); END IF;
  IF NOT (v_co IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta mudança'); END IF;

  UPDATE ehs_mudanca
     SET ativo         = false,
         excluido_em   = now(),
         excluido_por  = v_uid,
         observacoes   = left(coalesce(v_obs || ' ', '') || '[desativada: ' || btrim(p_motivo) || ']', 2000),
         atualizado_em = now()
   WHERE id = p_id;

  -- RD-98 p4: rastro de exclusão (quem/quando/motivo), como fn_ehs_pt_desativar
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_co, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'ehs_mudanca', p_id::text, 'ehs_mudanca_desativar',
          jsonb_build_object('titulo', v_titulo, 'ativo', true),
          jsonb_build_object('ativo', false, 'excluido_em', now(), 'excluido_por', v_uid, 'motivo', btrim(p_motivo)));

  RETURN jsonb_build_object('ok', true, 'titulo', v_titulo);
END $function$;

-- 3) Reescrita rastreável das ações de controle (fim do DELETE físico) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ehs_mudanca_acoes_salvar(p_mudanca_id uuid, p_acoes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_co          uuid;
  v_achou       boolean := false;
  v_desativadas int := 0;
  v_inseridas   int := 0;
  v_item        jsonb;
  v_ordem       int := 0;
  v_desc        text;
BEGIN
  SELECT true, company_id INTO v_achou, v_co FROM ehs_mudanca WHERE id = p_mudanca_id;
  IF NOT v_achou THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Mudança não encontrada'); END IF;
  IF NOT (v_co IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta mudança'); END IF;

  -- soft-delete das ações ativas atuais (NUNCA DELETE físico — RD-98 p4; a coleção-filha é versionada)
  UPDATE ehs_mudanca_acao
     SET ativo = false, excluido_em = now(), excluido_por = v_uid
   WHERE mudanca_id = p_mudanca_id AND ativo = true;
  GET DIAGNOSTICS v_desativadas = ROW_COUNT;

  -- insere a nova coleção (ignora linhas em branco)
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_acoes, '[]'::jsonb))
  LOOP
    v_desc := btrim(coalesce(v_item->>'descricao', ''));
    IF v_desc = '' THEN CONTINUE; END IF;
    v_ordem := v_ordem + 1;
    INSERT INTO ehs_mudanca_acao (company_id, mudanca_id, ordem, descricao, responsavel, prazo, concluido)
    VALUES (v_co, p_mudanca_id, v_ordem, v_desc,
            nullif(btrim(coalesce(v_item->>'responsavel', '')), ''),
            nullif(btrim(coalesce(v_item->>'prazo', '')), '')::date,
            coalesce((v_item->>'concluido')::boolean, false));
    v_inseridas := v_inseridas + 1;
  END LOOP;

  IF v_desativadas > 0 OR v_inseridas > 0 THEN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_co, v_uid, (SELECT email FROM users WHERE id = v_uid),
            'ehs_mudanca_acao', p_mudanca_id::text, 'ehs_mudanca_acoes_reescrita',
            jsonb_build_object('acoes_desativadas', v_desativadas),
            jsonb_build_object('acoes_inseridas', v_inseridas));
  END IF;

  RETURN jsonb_build_object('ok', true, 'desativadas', v_desativadas, 'inseridas', v_inseridas);
END $function$;

-- 4) RD-97 · guarda de acesso: SECURITY DEFINER não pode ficar aberta ao anon ─────────────────────────
REVOKE ALL ON FUNCTION public.fn_ehs_mudanca_desativar(uuid, text)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ehs_mudanca_acoes_salvar(uuid, jsonb)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_mudanca_desativar(uuid, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ehs_mudanca_acoes_salvar(uuid, jsonb)  TO authenticated;

-- 5) RD-98 p3 · origem do dado da tela ────────────────────────────────────────────────────────────────
UPDATE public.system_screens
   SET views_consumidas = ARRAY['ehs_mudanca','ehs_mudanca_acao'],
       rpcs_chamadas    = ARRAY['fn_ehs_mudanca_desativar','fn_ehs_mudanca_acoes_salvar'],
       estado_real      = 'pronto'
 WHERE rota = '/dashboard/ehs/trabalhos-risco/mudancas';
