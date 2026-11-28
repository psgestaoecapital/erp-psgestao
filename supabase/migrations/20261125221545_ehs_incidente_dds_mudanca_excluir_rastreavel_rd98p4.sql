-- PS EHS · PDCA auditor_pdca_1 (23/11, DEMO EHS b0700000-...-000b) — RD-98 p4 (exclusão rastreável) + p3 (origem do dado).
-- Replica o padrão da PR #5988 (Permissão de Trabalho) em 3 telas EHS auditadas, todas com o MESMO bloqueio:
--   /dashboard/ehs/incidentes                 (ehs_incidente       + ehs_incidente_testemunha)
--   /dashboard/ehs/dds                         (ehs_dds             + ehs_dds_presenca)
--   /dashboard/ehs/trabalhos-risco/mudancas    (ehs_mudanca         + ehs_mudanca_acao)
--
-- BLOQUEADOR (gap 1 · RD-98 p4): hoje cada tela desativava o registro com UPDATE ativo=false + texto solto,
--   SEM gravar quem/quando numa coluna própria e SEM audit_log; e ao SALVAR edição APAGAVA FISICAMENTE a
--   coleção-filha (testemunhas / presença / ações) com .delete(). Incidente é registro legal (NR-1/investigação),
--   a presença de DDS é prova de treinamento/assinatura e a MOC é documento de segurança → via revisada.
--   Fecha espelhando fn_ehs_pt_desativar / fn_ehs_pt_medidas_salvar (migration 20261125220045, PR #5988):
--     * cada tabela ganha excluido_em/excluido_por (rastro; o soft-delete continua por ativo=false);
--     * fn_ehs_<ent>_desativar: soft-delete do pai com quem/quando/motivo + registro em audit_log_global;
--     * fn_ehs_<ent>_<filhos>_salvar: reescreve a coleção-filha por SOFT-DELETE (ativo=false) + insert, com
--       audit — ACABA o DELETE físico; a página passa a chamar estas RPCs em vez de delete()+insert().
-- Origem do dado (gap 3 · RD-98 p3): system_screens das 3 rotas ganha views_consumidas/rpcs_chamadas e estado_real='pronto'.
--
-- ADITIVA e idempotente (ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, UPDATE por rota). Sem DROP/TRUNCATE e
-- sem UPDATE em massa de dado de cliente. Guarda por empresa mantida (get_user_company_ids()/is_admin()),
-- REVOKE anon + GRANT authenticated (RD-97). Code: desenvolvedor_5_g

-- 1) Colunas de rastro de exclusão (RD-98 p4) ─────────────────────────────────────────────────────────
-- Pais (já têm ativo): só o rastro de quem/quando.
ALTER TABLE public.ehs_incidente ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ehs_incidente ADD COLUMN IF NOT EXISTS excluido_por uuid;
ALTER TABLE public.ehs_dds       ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ehs_dds       ADD COLUMN IF NOT EXISTS excluido_por uuid;
ALTER TABLE public.ehs_mudanca   ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ehs_mudanca   ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- Filhas de incidente/dds: NÃO tinham coluna ativo (eram apagadas fisicamente). Ganham soft-delete.
ALTER TABLE public.ehs_incidente_testemunha ADD COLUMN IF NOT EXISTS ativo        boolean NOT NULL DEFAULT true;
ALTER TABLE public.ehs_incidente_testemunha ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ehs_incidente_testemunha ADD COLUMN IF NOT EXISTS excluido_por uuid;
ALTER TABLE public.ehs_dds_presenca         ADD COLUMN IF NOT EXISTS ativo        boolean NOT NULL DEFAULT true;
ALTER TABLE public.ehs_dds_presenca         ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ehs_dds_presenca         ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- Filha de mudança: já tinha ativo e já era filtrada por ativo=true; só o rastro.
ALTER TABLE public.ehs_mudanca_acao ADD COLUMN IF NOT EXISTS excluido_em  timestamptz;
ALTER TABLE public.ehs_mudanca_acao ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- ============================ INCIDENTES ============================
-- 2) Desativação rastreável do incidente (grava em descricao, como a tela) ────────────────────────────
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

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_co, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'ehs_incidente', p_id::text, 'ehs_incidente_desativar',
          jsonb_build_object('titulo', v_titulo, 'ativo', true),
          jsonb_build_object('ativo', false, 'excluido_em', now(), 'excluido_por', v_uid, 'motivo', btrim(p_motivo)));

  RETURN jsonb_build_object('ok', true, 'titulo', v_titulo);
END $function$;

-- 3) Reescrita rastreável das testemunhas (fim do DELETE físico) ───────────────────────────────────────
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

  UPDATE ehs_incidente_testemunha
     SET ativo = false, excluido_em = now(), excluido_por = v_uid
   WHERE incidente_id = p_incidente_id AND ativo = true;
  GET DIAGNOSTICS v_desativadas = ROW_COUNT;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_testemunhas, '[]'::jsonb))
  LOOP
    v_nome := btrim(coalesce(v_item->>'nome', ''));
    IF v_nome = '' THEN CONTINUE; END IF;
    INSERT INTO ehs_incidente_testemunha (company_id, incidente_id, nome, funcao, relato)
    VALUES (v_co, p_incidente_id, v_nome,
            nullif(btrim(coalesce(v_item->>'funcao','')), ''),
            nullif(btrim(coalesce(v_item->>'relato','')), ''));
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

-- ============================ DDS ============================
-- 4) Desativação rastreável do DDS (grava em observacoes) ──────────────────────────────────────────────
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

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_co, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'ehs_dds', p_id::text, 'ehs_dds_desativar',
          jsonb_build_object('tema', v_tema, 'ativo', true),
          jsonb_build_object('ativo', false, 'excluido_em', now(), 'excluido_por', v_uid, 'motivo', btrim(p_motivo)));

  RETURN jsonb_build_object('ok', true, 'tema', v_tema);
END $function$;

-- 5) Reescrita rastreável da presença (prova de treinamento — fim do DELETE físico) ───────────────────
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

  UPDATE ehs_dds_presenca
     SET ativo = false, excluido_em = now(), excluido_por = v_uid
   WHERE dds_id = p_dds_id AND ativo = true;
  GET DIAGNOSTICS v_desativadas = ROW_COUNT;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_presencas, '[]'::jsonb))
  LOOP
    v_nome := btrim(coalesce(v_item->>'participante_nome', ''));
    IF v_nome = '' THEN CONTINUE; END IF;
    INSERT INTO ehs_dds_presenca (company_id, dds_id, participante_nome, funcao, presente)
    VALUES (v_co, p_dds_id, v_nome,
            nullif(btrim(coalesce(v_item->>'funcao','')), ''),
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

-- ============================ MUDANÇAS (MOC) ============================
-- 6) Desativação rastreável da mudança (grava em observacoes) ─────────────────────────────────────────
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

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_co, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'ehs_mudanca', p_id::text, 'ehs_mudanca_desativar',
          jsonb_build_object('titulo', v_titulo, 'ativo', true),
          jsonb_build_object('ativo', false, 'excluido_em', now(), 'excluido_por', v_uid, 'motivo', btrim(p_motivo)));

  RETURN jsonb_build_object('ok', true, 'titulo', v_titulo);
END $function$;

-- 7) Reescrita rastreável das ações (fim do DELETE físico) ─────────────────────────────────────────────
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

  UPDATE ehs_mudanca_acao
     SET ativo = false, excluido_em = now(), excluido_por = v_uid
   WHERE mudanca_id = p_mudanca_id AND ativo = true;
  GET DIAGNOSTICS v_desativadas = ROW_COUNT;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_acoes, '[]'::jsonb))
  LOOP
    v_desc := btrim(coalesce(v_item->>'descricao', ''));
    IF v_desc = '' THEN CONTINUE; END IF;
    v_ordem := v_ordem + 1;
    INSERT INTO ehs_mudanca_acao (company_id, mudanca_id, ordem, descricao, responsavel, prazo, concluido)
    VALUES (v_co, p_mudanca_id, v_ordem, v_desc,
            nullif(btrim(coalesce(v_item->>'responsavel','')), ''),
            nullif(v_item->>'prazo','')::date,
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

-- 8) RD-97 · guarda de acesso (SECURITY DEFINER não fica aberta ao anon) ───────────────────────────────
REVOKE ALL ON FUNCTION public.fn_ehs_incidente_desativar(uuid, text)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ehs_incidente_testemunhas_salvar(uuid, jsonb)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ehs_dds_desativar(uuid, text)                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ehs_dds_presencas_salvar(uuid, jsonb)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ehs_mudanca_desativar(uuid, text)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ehs_mudanca_acoes_salvar(uuid, jsonb)          FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_incidente_desativar(uuid, text)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ehs_incidente_testemunhas_salvar(uuid, jsonb)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ehs_dds_desativar(uuid, text)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ehs_dds_presencas_salvar(uuid, jsonb)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ehs_mudanca_desativar(uuid, text)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ehs_mudanca_acoes_salvar(uuid, jsonb)          TO authenticated;

-- 9) RD-98 p3 · origem do dado das 3 telas ────────────────────────────────────────────────────────────
UPDATE public.system_screens
   SET views_consumidas = ARRAY['ehs_incidente','ehs_incidente_testemunha'],
       rpcs_chamadas    = ARRAY['fn_ehs_incidente_desativar','fn_ehs_incidente_testemunhas_salvar'],
       estado_real      = 'pronto'
 WHERE rota = '/dashboard/ehs/incidentes';

UPDATE public.system_screens
   SET views_consumidas = ARRAY['ehs_dds','ehs_dds_presenca'],
       rpcs_chamadas    = ARRAY['fn_ehs_dds_desativar','fn_ehs_dds_presencas_salvar'],
       estado_real      = 'pronto'
 WHERE rota = '/dashboard/ehs/dds';

UPDATE public.system_screens
   SET views_consumidas = ARRAY['ehs_mudanca','ehs_mudanca_acao'],
       rpcs_chamadas    = ARRAY['fn_ehs_mudanca_desativar','fn_ehs_mudanca_acoes_salvar'],
       estado_real      = 'pronto'
 WHERE rota = '/dashboard/ehs/trabalhos-risco/mudancas';
