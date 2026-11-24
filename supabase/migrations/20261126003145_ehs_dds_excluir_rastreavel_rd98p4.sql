-- PS EHS · EHS-7 / M10 DDS — Diálogo de Segurança (/dashboard/ehs/dds)
-- PDCA auditor_pdca_1 (23/11, DEMO EHS b0700000-...-000b) — RD-98 p4 (exclusão rastreável) + p3 (origem do dado).
--
-- BLOQUEADOR (gap 1): a presença do DDS é PROVA de treinamento/assinatura — perda física é gap legal.
--   HOJE a tela desativava o DDS com UPDATE ativo=false + texto em observacoes, SEM gravar quem/quando numa
--   coluna própria e SEM audit_log; e ao editar APAGAVA FISICAMENTE a lista de presença
--   (ehs_dds_presenca.delete). Fecha espelhando fn_ehs_pt_desativar/fn_ehs_pt_medidas_salvar (migration
--   20261125220045, PR #5988, RD-98 p4) e fn_epi_excluir (20261124061545):
--     * ehs_dds ganha excluido_em/excluido_por; ehs_dds_presenca ganha ativo + excluido_em/excluido_por
--       (soft-delete da presença, que antes nem tinha coluna de inativação);
--     * fn_ehs_dds_desativar: soft-delete do DDS com quem/quando/motivo + registro em audit_log_global;
--     * fn_ehs_dds_presencas_salvar: reescreve a lista de presença por SOFT-DELETE (ativo=false) + insert,
--       com audit — acaba o DELETE físico; a página passa a chamar esta RPC em vez de delete()+insert().
-- Origem do dado (gap 3): system_screens da rota ganha views_consumidas/rpcs_chamadas e estado_real='pronto'.
--
-- ADITIVA e idempotente (ADD COLUMN IF NOT EXISTS com DEFAULT, CREATE OR REPLACE, UPDATE idempotente). Sem
-- DROP/TRUNCATE e sem UPDATE em massa de dado de cliente. Dado de segurança → via revisada (revisao-eng-chefe).
-- Guarda por empresa mantida (get_user_company_ids()/is_admin()). Code: desenvolvedor_5_g

-- 1) Colunas de rastro de exclusão (RD-98 p4) ─────────────────────────────────────────────────────────
ALTER TABLE public.ehs_dds          ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ehs_dds          ADD COLUMN IF NOT EXISTS excluido_por uuid;
ALTER TABLE public.ehs_dds_presenca ADD COLUMN IF NOT EXISTS ativo        boolean NOT NULL DEFAULT true;
ALTER TABLE public.ehs_dds_presenca ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ehs_dds_presenca ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- 2) Desativação rastreável do DDS ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ehs_dds_desativar(p_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_co    uuid;
  v_tema  text;
  v_obs   text;
  v_achou boolean := false;
BEGIN
  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o motivo para desativar.');
  END IF;

  SELECT true, company_id, tema, observacoes
    INTO v_achou, v_co, v_tema, v_obs
  FROM ehs_dds WHERE id = p_id;
  IF NOT v_achou THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'DDS não encontrado'); END IF;
  IF NOT (v_co IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a este DDS'); END IF;

  UPDATE ehs_dds
     SET ativo         = false,
         excluido_em   = now(),
         excluido_por  = v_uid,
         observacoes   = left(coalesce(v_obs || ' ', '') || '[desativado: ' || btrim(p_motivo) || ']', 2000),
         atualizado_em = now()
   WHERE id = p_id;

  -- RD-98 p4: rastro de exclusão (quem/quando/motivo), como fn_ehs_pt_desativar
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_co, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'ehs_dds', p_id::text, 'ehs_dds_desativar',
          jsonb_build_object('tema', v_tema, 'ativo', true),
          jsonb_build_object('ativo', false, 'excluido_em', now(), 'excluido_por', v_uid, 'motivo', btrim(p_motivo)));

  RETURN jsonb_build_object('ok', true, 'tema', v_tema);
END $function$;

-- 3) Reescrita rastreável da lista de presença (fim do DELETE físico) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ehs_dds_presencas_salvar(p_dds_id uuid, p_presencas jsonb)
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
  v_nome        text;
BEGIN
  SELECT true, company_id INTO v_achou, v_co FROM ehs_dds WHERE id = p_dds_id;
  IF NOT v_achou THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'DDS não encontrado'); END IF;
  IF NOT (v_co IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a este DDS'); END IF;

  -- soft-delete da presença ativa atual (NUNCA DELETE físico — RD-98 p4; a presença é prova de treinamento)
  UPDATE ehs_dds_presenca
     SET ativo = false, excluido_em = now(), excluido_por = v_uid
   WHERE dds_id = p_dds_id AND ativo = true;
  GET DIAGNOSTICS v_desativadas = ROW_COUNT;

  -- insere a nova lista (ignora linhas sem nome)
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_presencas, '[]'::jsonb))
  LOOP
    v_nome := btrim(coalesce(v_item->>'participante_nome', ''));
    IF v_nome = '' THEN CONTINUE; END IF;
    INSERT INTO ehs_dds_presenca (company_id, dds_id, participante_nome, funcao, presente)
    VALUES (v_co, p_dds_id, v_nome,
            nullif(btrim(coalesce(v_item->>'funcao', '')), ''),
            coalesce((v_item->>'presente')::boolean, true));
    v_inseridas := v_inseridas + 1;
  END LOOP;

  IF v_desativadas > 0 OR v_inseridas > 0 THEN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_co, v_uid, (SELECT email FROM users WHERE id = v_uid),
            'ehs_dds_presenca', p_dds_id::text, 'ehs_dds_presencas_reescrita',
            jsonb_build_object('presencas_desativadas', v_desativadas),
            jsonb_build_object('presencas_inseridas', v_inseridas));
  END IF;

  RETURN jsonb_build_object('ok', true, 'desativadas', v_desativadas, 'inseridas', v_inseridas);
END $function$;

-- 4) RD-97 · guarda de acesso: SECURITY DEFINER não pode ficar aberta ao anon ─────────────────────────
REVOKE ALL ON FUNCTION public.fn_ehs_dds_desativar(uuid, text)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ehs_dds_presencas_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_dds_desativar(uuid, text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ehs_dds_presencas_salvar(uuid, jsonb) TO authenticated;

-- 5) RD-98 p3 · origem do dado da tela ────────────────────────────────────────────────────────────────
UPDATE public.system_screens
   SET views_consumidas = ARRAY['ehs_dds','ehs_dds_presenca'],
       rpcs_chamadas    = ARRAY['fn_ehs_dds_desativar','fn_ehs_dds_presencas_salvar'],
       estado_real      = 'pronto'
 WHERE rota = '/dashboard/ehs/dds';
