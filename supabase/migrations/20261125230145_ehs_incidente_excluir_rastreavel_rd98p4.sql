-- PS EHS · EHS-7 / M12 Incidentes e investigação (/dashboard/ehs/incidentes)
-- PDCA auditor_pdca_1 (23/11, DEMO EHS) — RD-98 p4 (exclusão rastreável) + p3 (origem do dado).
-- Replica o padrão da PR #5988 (Permissão de Trabalho) / fn_epi_excluir.
--
-- BLOQUEADOR (gap 1): o incidente é registro legal (NR-1/investigação, base de CAT).
--   HOJE a tela desativava com UPDATE ativo=false + texto em descricao, SEM gravar quem/quando numa coluna
--   própria e SEM audit_log; e ao editar APAGAVA FISICAMENTE as testemunhas (ehs_incidente_testemunha.delete).
--   Fecha:
--     * ehs_incidente ganha excluido_em/excluido_por;
--     * ehs_incidente_testemunha ganha ativo (default true) + excluido_em/excluido_por — a testemunha passa a
--       ser versionada por soft-delete (depoimento é prova; perda física é gap legal);
--     * fn_ehs_incidente_desativar: soft-delete do incidente com quem/quando/motivo + registro em audit_log_global;
--     * fn_ehs_incidente_testemunhas_salvar: reescreve a coleção por SOFT-DELETE (ativo=false) + insert, com
--       audit — acaba o DELETE físico; a página passa a chamar esta RPC em vez de delete()+insert().
-- Origem do dado (gap 3): system_screens da rota ganha views_consumidas/rpcs_chamadas e estado_real='pronto'.
--
-- ADITIVA e idempotente (ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE). Sem DROP/TRUNCATE e sem UPDATE em massa
-- de dado de cliente. Dado de segurança/legal → via revisada (revisao-eng-chefe). Guarda por empresa mantida
-- (get_user_company_ids()/is_admin()). Code: desenvolvedor_5_g

-- 1) Colunas de rastro de exclusão (RD-98 p4) ─────────────────────────────────────────────────────────
ALTER TABLE public.ehs_incidente            ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ehs_incidente            ADD COLUMN IF NOT EXISTS excluido_por uuid;
ALTER TABLE public.ehs_incidente_testemunha ADD COLUMN IF NOT EXISTS ativo        boolean NOT NULL DEFAULT true;
ALTER TABLE public.ehs_incidente_testemunha ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ehs_incidente_testemunha ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- 2) Desativação rastreável do incidente ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ehs_incidente_desativar(p_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_co     uuid;
  v_titulo text;
  v_desc   text;
  v_achou  boolean := false;
BEGIN
  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o motivo para desativar.');
  END IF;

  SELECT true, company_id, titulo, descricao
    INTO v_achou, v_co, v_titulo, v_desc
  FROM ehs_incidente WHERE id = p_id;
  IF NOT v_achou THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Incidente não encontrado'); END IF;
  IF NOT (v_co IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a este incidente'); END IF;

  UPDATE ehs_incidente
     SET ativo         = false,
         excluido_em   = now(),
         excluido_por  = v_uid,
         descricao     = left(coalesce(v_desc || ' ', '') || '[desativado: ' || btrim(p_motivo) || ']', 4000),
         atualizado_em = now()
   WHERE id = p_id;

  -- RD-98 p4: rastro de exclusão (quem/quando/motivo), como fn_epi_excluir
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_co, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'ehs_incidente', p_id::text, 'ehs_incidente_desativar',
          jsonb_build_object('titulo', v_titulo, 'ativo', true),
          jsonb_build_object('ativo', false, 'excluido_em', now(), 'excluido_por', v_uid, 'motivo', btrim(p_motivo)));

  RETURN jsonb_build_object('ok', true, 'titulo', v_titulo);
END $function$;

-- 3) Reescrita rastreável das testemunhas (fim do DELETE físico) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ehs_incidente_testemunhas_salvar(p_incidente_id uuid, p_testemunhas jsonb)
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
  SELECT true, company_id INTO v_achou, v_co FROM ehs_incidente WHERE id = p_incidente_id;
  IF NOT v_achou THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Incidente não encontrado'); END IF;
  IF NOT (v_co IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a este incidente'); END IF;

  -- soft-delete das testemunhas ativas atuais (NUNCA DELETE físico — RD-98 p4; depoimento é prova)
  UPDATE ehs_incidente_testemunha
     SET ativo = false, excluido_em = now(), excluido_por = v_uid
   WHERE incidente_id = p_incidente_id AND ativo = true;
  GET DIAGNOSTICS v_desativadas = ROW_COUNT;

  -- insere a nova coleção (ignora linhas sem nome)
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_testemunhas, '[]'::jsonb))
  LOOP
    v_nome := btrim(coalesce(v_item->>'nome', ''));
    IF v_nome = '' THEN CONTINUE; END IF;
    INSERT INTO ehs_incidente_testemunha (company_id, incidente_id, nome, funcao, relato)
    VALUES (v_co, p_incidente_id, v_nome,
            NULLIF(btrim(coalesce(v_item->>'funcao', '')), ''),
            NULLIF(btrim(coalesce(v_item->>'relato', '')), ''));
    v_inseridas := v_inseridas + 1;
  END LOOP;

  IF v_desativadas > 0 OR v_inseridas > 0 THEN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_co, v_uid, (SELECT email FROM users WHERE id = v_uid),
            'ehs_incidente_testemunha', p_incidente_id::text, 'ehs_incidente_testemunhas_reescrita',
            jsonb_build_object('testemunhas_desativadas', v_desativadas),
            jsonb_build_object('testemunhas_inseridas', v_inseridas));
  END IF;

  RETURN jsonb_build_object('ok', true, 'desativadas', v_desativadas, 'inseridas', v_inseridas);
END $function$;

-- 4) RD-97 · guarda de acesso: SECURITY DEFINER não pode ficar aberta ao anon ─────────────────────────
REVOKE ALL ON FUNCTION public.fn_ehs_incidente_desativar(uuid, text)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ehs_incidente_testemunhas_salvar(uuid, jsonb)   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_incidente_desativar(uuid, text)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ehs_incidente_testemunhas_salvar(uuid, jsonb)  TO authenticated;

-- 5) RD-98 p3 · origem do dado da tela ────────────────────────────────────────────────────────────────
UPDATE public.system_screens
   SET views_consumidas = ARRAY['ehs_incidente','ehs_incidente_testemunha'],
       rpcs_chamadas    = ARRAY['fn_ehs_incidente_desativar','fn_ehs_incidente_testemunhas_salvar'],
       estado_real      = 'pronto'
 WHERE rota = '/dashboard/ehs/incidentes';
