-- PS EHS · M2 (/dashboard/ehs/matriz/epi-posto) — RD-98 p4: a inclusão e a remoção do vínculo
-- posto↔EPI obrigatório (NR-6) eram feitas direto no client (supabase.from('prod_posto_epi')
-- .insert/.delete()), sem quem/quando nem rastro, e o Remover fazia DELETE FÍSICO do vínculo.
-- Este PR fecha o gap:
--   * prod_posto_epi ganha excluido_em/excluido_por (soft-delete; nunca DELETE físico);
--   * 2 RPCs SECURITY DEFINER com a MESMA guarda da RLS da tabela
--     (company_id IN get_user_company_ids() OR is_admin()) e rastro em audit_log_global (NR-6);
--   * a tela passa a chamar as RPCs e a listar só os vínculos vivos (excluido_em IS NULL).
-- Tudo ADITIVO e idempotente. Escopo por company_id. REVOKE anon.
-- Code: desenvolvedor_5_g

-- 1) Soft-delete rastreável (aditivo, idempotente)
ALTER TABLE public.prod_posto_epi ADD COLUMN IF NOT EXISTS excluido_em timestamptz;
ALTER TABLE public.prod_posto_epi ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- 2) INCLUIR/atualizar vínculo posto↔EPI (reaproveita linha soft-deletada do mesmo par)
CREATE OR REPLACE FUNCTION public.fn_ehs_posto_epi_incluir(
  p_company_id uuid, p_posto_id uuid, p_catalogo_id uuid, p_obrigatorio boolean DEFAULT true, p_observacao text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_obs text := nullif(btrim(p_observacao), '');
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF NOT EXISTS (SELECT 1 FROM prod_posto WHERE id = p_posto_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'posto de outra empresa'); END IF;
  IF NOT EXISTS (SELECT 1 FROM epi_catalogo WHERE id = p_catalogo_id AND (company_id = p_company_id OR is_global = true)) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'EPI do catálogo inválido para esta empresa'); END IF;

  -- vínculo vivo já existe → só ajusta obrigatoriedade/observação
  SELECT id INTO v_id FROM prod_posto_epi
   WHERE company_id = p_company_id AND posto_id = p_posto_id AND catalogo_id = p_catalogo_id AND excluido_em IS NULL
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    UPDATE prod_posto_epi SET obrigatorio = p_obrigatorio, observacao = v_obs WHERE id = v_id;
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_novo)
    VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'prod_posto_epi', v_id, 'posto_epi_atualizar',
            jsonb_build_object('posto_id', p_posto_id, 'catalogo_id', p_catalogo_id, 'obrigatorio', p_obrigatorio, 'observacao', v_obs));
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'atualizado', true);
  END IF;

  -- vínculo soft-deletado do mesmo par → reativa
  SELECT id INTO v_id FROM prod_posto_epi
   WHERE company_id = p_company_id AND posto_id = p_posto_id AND catalogo_id = p_catalogo_id AND excluido_em IS NOT NULL
   ORDER BY excluido_em DESC LIMIT 1;
  IF v_id IS NOT NULL THEN
    UPDATE prod_posto_epi SET excluido_em = NULL, excluido_por = NULL, obrigatorio = p_obrigatorio, observacao = v_obs WHERE id = v_id;
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_novo)
    VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'prod_posto_epi', v_id, 'posto_epi_reativar',
            jsonb_build_object('posto_id', p_posto_id, 'catalogo_id', p_catalogo_id, 'obrigatorio', p_obrigatorio, 'observacao', v_obs));
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'reativado', true);
  END IF;

  -- novo vínculo
  INSERT INTO prod_posto_epi (company_id, posto_id, catalogo_id, obrigatorio, observacao)
  VALUES (p_company_id, p_posto_id, p_catalogo_id, p_obrigatorio, v_obs)
  RETURNING id INTO v_id;
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'prod_posto_epi', v_id, 'posto_epi_incluir',
          jsonb_build_object('posto_id', p_posto_id, 'catalogo_id', p_catalogo_id, 'obrigatorio', p_obrigatorio, 'observacao', v_obs));
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- 3) REMOVER rastreável (soft-delete; nunca DELETE físico)
CREATE OR REPLACE FUNCTION public.fn_ehs_posto_epi_remover(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_r prod_posto_epi%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM prod_posto_epi WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'vínculo não encontrado'); END IF;
  IF NOT (v_r.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF v_r.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'ja_excluido', true); END IF;

  UPDATE prod_posto_epi SET excluido_em = now(), excluido_por = v_uid WHERE id = p_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_r.company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'prod_posto_epi', p_id, 'posto_epi_remover',
          jsonb_build_object('posto_id', v_r.posto_id, 'catalogo_id', v_r.catalogo_id, 'obrigatorio', v_r.obrigatorio, 'observacao', v_r.observacao),
          jsonb_build_object('excluido_em', now(), 'excluido_por', v_uid, 'motivo', p_motivo));

  RETURN jsonb_build_object('ok', true);
END $function$;

-- 4) Trancar as RPCs (sem anon; só usuário logado / serviço)
REVOKE ALL ON FUNCTION public.fn_ehs_posto_epi_incluir(uuid, uuid, uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ehs_posto_epi_remover(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_posto_epi_incluir(uuid, uuid, uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ehs_posto_epi_remover(uuid, text) TO authenticated, service_role;
