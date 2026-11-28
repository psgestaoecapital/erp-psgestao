-- PS EHS · EHS-7 / M10 Modelos de inspeção (/dashboard/ehs/inspecoes/modelos)
-- PDCA auditor_pdca_1 (23/11, DEMO EHS b0700000-...) — RD-98 p4 (exclusão rastreável) + p3 (origem do dado).
--
-- BLOQUEADOR (gap 1): HOJE a tela desativava o modelo com UPDATE ativo=false + texto em descricao, SEM gravar
--   quem/quando numa coluna própria e SEM audit_log; e ao editar APAGAVA FISICAMENTE os itens do checklist
--   (ehs_inspecao_item.delete). Fecha espelhando fn_ehs_pt_* (PR #5988) e fn_epi_excluir (RD-98 p4):
--     * ehs_inspecao_modelo e ehs_inspecao_item ganham excluido_em/excluido_por (rastro; soft-delete por ativo=false);
--     * fn_ehs_inspecao_modelo_desativar: soft-delete do modelo com quem/quando/motivo + registro em audit_log_global;
--     * fn_ehs_inspecao_item_salvar: reescreve a coleção de perguntas por SOFT-DELETE (ativo=false) + insert, com
--       audit — acaba o DELETE físico; a página passa a chamar esta RPC em vez de delete()+insert().
-- Origem do dado (gap 3): system_screens da rota ganha views_consumidas/rpcs_chamadas e estado_real='pronto'.
--
-- ADITIVA e idempotente (ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, UPDATE idempotente). Sem DROP/TRUNCATE e
-- sem UPDATE em massa de dado de cliente. Guarda por empresa mantida (get_user_company_ids()/is_admin()).
-- Code: desenvolvedor_5_g

-- 1) Colunas de rastro de exclusão (RD-98 p4) ─────────────────────────────────────────────────────────
ALTER TABLE public.ehs_inspecao_modelo ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ehs_inspecao_modelo ADD COLUMN IF NOT EXISTS excluido_por uuid;
ALTER TABLE public.ehs_inspecao_item   ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ehs_inspecao_item   ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- 2) Desativação rastreável do modelo ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ehs_inspecao_modelo_desativar(p_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_co    uuid;
  v_nome  text;
  v_desc  text;
  v_achou boolean := false;
BEGIN
  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o motivo para desativar.');
  END IF;

  SELECT true, company_id, nome, descricao
    INTO v_achou, v_co, v_nome, v_desc
  FROM ehs_inspecao_modelo WHERE id = p_id;
  IF NOT v_achou THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Modelo de inspeção não encontrado'); END IF;
  IF NOT (v_co IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a este modelo de inspeção'); END IF;

  UPDATE ehs_inspecao_modelo
     SET ativo         = false,
         excluido_em   = now(),
         excluido_por  = v_uid,
         descricao     = left(coalesce(v_desc || ' ', '') || '[desativado: ' || btrim(p_motivo) || ']', 2000),
         atualizado_em = now()
   WHERE id = p_id;

  -- RD-98 p4: rastro de exclusão (quem/quando/motivo)
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_co, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'ehs_inspecao_modelo', p_id::text, 'ehs_inspecao_modelo_desativar',
          jsonb_build_object('nome', v_nome, 'ativo', true),
          jsonb_build_object('ativo', false, 'excluido_em', now(), 'excluido_por', v_uid, 'motivo', btrim(p_motivo)));

  RETURN jsonb_build_object('ok', true, 'nome', v_nome);
END $function$;

-- 3) Reescrita rastreável das perguntas do checklist (fim do DELETE físico) ───────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ehs_inspecao_item_salvar(p_modelo_id uuid, p_itens jsonb)
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
  v_pergunta    text;
BEGIN
  SELECT true, company_id INTO v_achou, v_co FROM ehs_inspecao_modelo WHERE id = p_modelo_id;
  IF NOT v_achou THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Modelo de inspeção não encontrado'); END IF;
  IF NOT (v_co IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a este modelo de inspeção'); END IF;

  -- soft-delete das perguntas ativas atuais (NUNCA DELETE físico — RD-98 p4; a coleção-filha é versionada)
  UPDATE ehs_inspecao_item
     SET ativo = false, excluido_em = now(), excluido_por = v_uid
   WHERE modelo_id = p_modelo_id AND ativo = true;
  GET DIAGNOSTICS v_desativadas = ROW_COUNT;

  -- insere a nova coleção (ignora perguntas em branco)
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_itens, '[]'::jsonb))
  LOOP
    v_pergunta := btrim(coalesce(v_item->>'pergunta', ''));
    IF v_pergunta = '' THEN CONTINUE; END IF;
    v_ordem := v_ordem + 1;
    INSERT INTO ehs_inspecao_item (company_id, modelo_id, ordem, pergunta, peso, critico)
    VALUES (v_co, p_modelo_id, v_ordem, v_pergunta,
            greatest(1, least(5, coalesce((v_item->>'peso')::int, 1))),
            coalesce((v_item->>'critico')::boolean, false));
    v_inseridas := v_inseridas + 1;
  END LOOP;

  IF v_desativadas > 0 OR v_inseridas > 0 THEN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_co, v_uid, (SELECT email FROM users WHERE id = v_uid),
            'ehs_inspecao_item', p_modelo_id::text, 'ehs_inspecao_itens_reescrita',
            jsonb_build_object('itens_desativados', v_desativadas),
            jsonb_build_object('itens_inseridos', v_inseridas));
  END IF;

  RETURN jsonb_build_object('ok', true, 'desativadas', v_desativadas, 'inseridas', v_inseridas);
END $function$;

-- 4) RD-97 · guarda de acesso: SECURITY DEFINER não pode ficar aberta ao anon ─────────────────────────
REVOKE ALL ON FUNCTION public.fn_ehs_inspecao_modelo_desativar(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ehs_inspecao_item_salvar(uuid, jsonb)     FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_inspecao_modelo_desativar(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ehs_inspecao_item_salvar(uuid, jsonb)     TO authenticated;

-- 5) RD-98 p3 · origem do dado da tela ────────────────────────────────────────────────────────────────
UPDATE public.system_screens
   SET views_consumidas = ARRAY['ehs_inspecao_modelo','ehs_inspecao_item'],
       rpcs_chamadas    = ARRAY['fn_ehs_inspecao_modelo_desativar','fn_ehs_inspecao_item_salvar'],
       estado_real      = 'pronto'
 WHERE rota = '/dashboard/ehs/inspecoes/modelos';
