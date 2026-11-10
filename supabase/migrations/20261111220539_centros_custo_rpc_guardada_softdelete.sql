-- GE · Centros de custo (PDCA auditor_pdca_2 08/11 — itens 3 e 4 do laudo):
-- tirar a escrita DIRETA do client em cost_center_map (tabela de NÚCLEO que alimenta
-- rateio -> resultado-por-negócio -> DRE) e padronizar em RPC guardada + exclusão RASTREÁVEL.
--   * 3 RPCs SECURITY DEFINER com a MESMA guarda das demais da GE
--     (company_id IN get_user_company_ids() OR is_admin()) e rastro em audit_log_global;
--   * EXCLUSÃO sempre por soft-delete (ativo=false) — nunca mais DELETE físico (RD-98.4);
--   * MAPEAR valida business_line_id e lote_id da MESMA empresa (escopo por empresa, RD-45).
-- ADITIVO (não altera coluna/dado existente), idempotente (CREATE OR REPLACE), REVOKE anon.
-- Preserva a regra viva: re-mapear = substituir o mapeamento do centro (delete+insert do próprio centro).

-- 1) MAPEAR centro de custo (substitui o delete+insert direto do client)
CREATE OR REPLACE FUNCTION public.fn_centro_custo_mapear(
  p_company_id uuid, p_source_key text, p_tipo text DEFAULT 'comum',
  p_business_line_id uuid DEFAULT NULL, p_lote_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := btrim(coalesce(p_source_key, ''));
  v_lote uuid;
  v_id uuid;
  v_prev jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF v_key = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'informe o nome do centro de custo'); END IF;
  -- domínio real de tipo_apropriacao (a tela oferece os três; "extra" = fora do rateio, revisar)
  IF p_tipo NOT IN ('comum', 'direto', 'extra') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tipo inválido (use comum, direto ou extra)'); END IF;
  IF p_business_line_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM business_lines WHERE id = p_business_line_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'linha de negócio de outra empresa'); END IF;
  -- lote só faz sentido na apropriação direta (dimensão agro); nos demais ramos fica nulo
  v_lote := CASE WHEN p_tipo = 'direto' THEN p_lote_id ELSE NULL END;
  IF v_lote IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM erp_pec_lote WHERE id = v_lote AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'lote de outra empresa'); END IF;

  SELECT jsonb_build_object('business_line_id', business_line_id, 'tipo_apropriacao', tipo_apropriacao,
                            'lote_id', lote_id, 'ativo', ativo)
    INTO v_prev
    FROM cost_center_map
   WHERE company_id = p_company_id AND source_type = 'centro_custo' AND source_key = v_key
   ORDER BY updated_at DESC NULLS LAST
   LIMIT 1;

  -- re-mapeia: substitui o mapeamento deste centro (mantém a regra viva do client)
  DELETE FROM cost_center_map
   WHERE company_id = p_company_id AND source_type = 'centro_custo' AND source_key = v_key;

  INSERT INTO cost_center_map (company_id, source_type, source_key, business_line_id, tipo_apropriacao,
                               lote_id, allocation_pct, cost_scope, priority, ativo)
  VALUES (p_company_id, 'centro_custo', v_key, p_business_line_id, p_tipo,
          v_lote, 100, 'todos', 0, true)
  RETURNING id INTO v_id;

  -- o centro passa a aparecer na lista "Centro de custo" ao lançar despesa/receita (a lista lê erp_centros_custo)
  IF NOT EXISTS (SELECT 1 FROM erp_centros_custo WHERE company_id = p_company_id AND nome = v_key) THEN
    INSERT INTO erp_centros_custo (company_id, nome, codigo, ativo) VALUES (p_company_id, v_key, v_key, true);
  END IF;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'cost_center_map', v_id::text, 'centro_custo_mapear',
          v_prev,
          jsonb_build_object('source_key', v_key, 'business_line_id', p_business_line_id,
                             'tipo_apropriacao', p_tipo, 'lote_id', v_lote, 'ativo', true));

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- 2) EXCLUIR centro de custo — SEMPRE soft-delete (ativo=false); nunca DELETE físico (RD-98.4)
CREATE OR REPLACE FUNCTION public.fn_centro_custo_excluir(
  p_company_id uuid, p_source_key text, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := btrim(coalesce(p_source_key, ''));
  v_n int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF v_key = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'centro de custo não informado'); END IF;

  UPDATE cost_center_map
     SET ativo = false, updated_at = now()
   WHERE company_id = p_company_id AND source_type = 'centro_custo' AND source_key = v_key AND ativo = true;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RETURN jsonb_build_object('ok', true, 'ja_inativo', true); END IF;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'cost_center_map', v_key, 'centro_custo_excluir',
          jsonb_build_object('source_key', v_key, 'ativo', true),
          jsonb_build_object('source_key', v_key, 'ativo', false, 'motivo', p_motivo, 'linhas', v_n));

  RETURN jsonb_build_object('ok', true, 'inativados', v_n);
END $function$;

-- 3) REATIVAR centro de custo (volta ativo=true)
CREATE OR REPLACE FUNCTION public.fn_centro_custo_reativar(
  p_company_id uuid, p_source_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := btrim(coalesce(p_source_key, ''));
  v_n int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF v_key = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'centro de custo não informado'); END IF;

  UPDATE cost_center_map
     SET ativo = true, updated_at = now()
   WHERE company_id = p_company_id AND source_type = 'centro_custo' AND source_key = v_key AND ativo = false;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'cost_center_map', v_key, 'centro_custo_reativar',
          jsonb_build_object('source_key', v_key, 'ativo', false),
          jsonb_build_object('source_key', v_key, 'ativo', true, 'linhas', v_n));

  RETURN jsonb_build_object('ok', true, 'reativados', v_n);
END $function$;

-- 4) Trancar as RPCs (sem anon; só usuário logado / serviço)
REVOKE ALL ON FUNCTION public.fn_centro_custo_mapear(uuid, text, text, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_centro_custo_excluir(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_centro_custo_reativar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_centro_custo_mapear(uuid, text, text, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_centro_custo_excluir(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_centro_custo_reativar(uuid, text) TO authenticated, service_role;
