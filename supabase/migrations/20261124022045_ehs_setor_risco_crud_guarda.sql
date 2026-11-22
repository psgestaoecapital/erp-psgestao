-- PS EHS · M2 (/dashboard/ehs/matriz/risco-setor) — RD-98 p4: a inclusão, a alteração e a
-- EXCLUSÃO do risco de setor (base do GRO/PGR, NR-1/NR-9) eram feitas direto no client
-- (supabase.from('prod_setor_risco').insert/.update/.delete()), sem quem/quando nem rastro, e o
-- Excluir fazia DELETE FÍSICO de um registro LEGAL. Este PR fecha o gap:
--   * prod_setor_risco ganha excluido_em/excluido_por (soft-delete; nunca DELETE físico de risco);
--   * 3 RPCs SECURITY DEFINER com a MESMA guarda da RLS da tabela
--     (company_id IN get_user_company_ids() OR is_admin()) e rastro em audit_log_global (NR-1);
--   * a tela passa a chamar as RPCs e a listar só os riscos vivos (excluido_em IS NULL).
-- Tudo ADITIVO e idempotente. Escopo por company_id. REVOKE anon.
-- Code: desenvolvedor_5_g

-- 1) Soft-delete rastreável (aditivo, idempotente)
ALTER TABLE public.prod_setor_risco ADD COLUMN IF NOT EXISTS excluido_em timestamptz;
ALTER TABLE public.prod_setor_risco ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- 2) INCLUIR risco de setor (guarda por empresa + audit_log)
CREATE OR REPLACE FUNCTION public.fn_ehs_setor_risco_incluir(
  p_company_id uuid, p_setor_id uuid, p_tipo text, p_descricao text, p_grau text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF NOT EXISTS (SELECT 1 FROM prod_setor WHERE id = p_setor_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'setor de outra empresa'); END IF;
  IF coalesce(btrim(p_tipo), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tipo obrigatório'); END IF;
  IF coalesce(btrim(p_descricao), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'descrição obrigatória'); END IF;

  INSERT INTO prod_setor_risco (company_id, setor_id, tipo, descricao, grau)
  VALUES (p_company_id, p_setor_id, lower(btrim(p_tipo)), btrim(p_descricao), nullif(lower(btrim(p_grau)), ''))
  RETURNING id INTO v_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'prod_setor_risco', v_id, 'setor_risco_incluir',
          jsonb_build_object('setor_id', p_setor_id, 'tipo', lower(btrim(p_tipo)), 'descricao', btrim(p_descricao), 'grau', nullif(lower(btrim(p_grau)), '')));
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- 3) ALTERAR risco de setor (guarda por empresa + audit_log com valor anterior)
CREATE OR REPLACE FUNCTION public.fn_ehs_setor_risco_alterar(
  p_id uuid, p_setor_id uuid, p_tipo text, p_descricao text, p_grau text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_r prod_setor_risco%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM prod_setor_risco WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'risco não encontrado'); END IF;
  IF NOT (v_r.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF v_r.excluido_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'risco excluído'); END IF;
  IF NOT EXISTS (SELECT 1 FROM prod_setor WHERE id = p_setor_id AND company_id = v_r.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'setor de outra empresa'); END IF;
  IF coalesce(btrim(p_tipo), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tipo obrigatório'); END IF;
  IF coalesce(btrim(p_descricao), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'descrição obrigatória'); END IF;

  UPDATE prod_setor_risco
     SET setor_id = p_setor_id, tipo = lower(btrim(p_tipo)), descricao = btrim(p_descricao), grau = nullif(lower(btrim(p_grau)), '')
   WHERE id = p_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_r.company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'prod_setor_risco', p_id, 'setor_risco_alterar',
          jsonb_build_object('setor_id', v_r.setor_id, 'tipo', v_r.tipo, 'descricao', v_r.descricao, 'grau', v_r.grau),
          jsonb_build_object('setor_id', p_setor_id, 'tipo', lower(btrim(p_tipo)), 'descricao', btrim(p_descricao), 'grau', nullif(lower(btrim(p_grau)), '')));
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END $function$;

-- 4) EXCLUIR risco de setor rastreável (soft-delete; nunca DELETE físico de registro de PGR)
CREATE OR REPLACE FUNCTION public.fn_ehs_setor_risco_excluir(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_r prod_setor_risco%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM prod_setor_risco WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'risco não encontrado'); END IF;
  IF NOT (v_r.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF v_r.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'ja_excluido', true); END IF;

  UPDATE prod_setor_risco SET excluido_em = now(), excluido_por = v_uid WHERE id = p_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_r.company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'prod_setor_risco', p_id, 'setor_risco_excluir',
          jsonb_build_object('setor_id', v_r.setor_id, 'tipo', v_r.tipo, 'descricao', v_r.descricao, 'grau', v_r.grau),
          jsonb_build_object('excluido_em', now(), 'excluido_por', v_uid, 'motivo', p_motivo));
  RETURN jsonb_build_object('ok', true);
END $function$;

-- 5) Trancar as RPCs (sem anon; só usuário logado / serviço)
REVOKE ALL ON FUNCTION public.fn_ehs_setor_risco_incluir(uuid, uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ehs_setor_risco_alterar(uuid, uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ehs_setor_risco_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_setor_risco_incluir(uuid, uuid, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ehs_setor_risco_alterar(uuid, uuid, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ehs_setor_risco_excluir(uuid, text) TO authenticated, service_role;
