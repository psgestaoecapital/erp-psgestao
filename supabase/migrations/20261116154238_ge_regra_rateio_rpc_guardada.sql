-- PDCA GE (auditor_pdca_2 13/11) — /dashboard/gestao-empresarial/centros-custo, painel "Regras de rateio"
-- (RegrasRateio.tsx). Gaps: (1) RD-98 p4 — exclusão de regra era DELETE físico (sem autor/audit, apaga
-- histórico); (2) INSERT direto client-side (sem RPC guardada, só RLS); (3) CRUD incompleto — sem Editar.
--
-- Entrega: RPCs guardadas por empresa (get_user_company_ids/is_admin), com validação server-side
-- (tipo, chave, %, soma <= 100, conta existe, negócio da empresa) e rastro em audit_log_global.
-- Exclusão passa a ser SOFT-DELETE (ativo = false) + audit. Edição in-place por id (sem precisar
-- "tirar e recriar"). Aditivo: só cria funções novas; não altera dado de cliente nem RLS existente.
-- As regras de conta/texto não ficam gravadas em lançamento nenhum (o cálculo é sempre na hora),
-- então o soft-delete preserva o histórico de auditoria sem afetar lançamentos.

-- ── Criar / Editar regra de rateio (conta|texto) — guardada ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ge_regra_rateio_salvar(
  p_company_id uuid,
  p_source_type text,
  p_source_key text,
  p_business_line_id uuid,
  p_allocation_pct numeric,
  p_id uuid DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid    := auth.uid();
  v_key  text    := btrim(coalesce(p_source_key, ''));
  v_type text    := lower(btrim(coalesce(p_source_type, '')));
  v_pct  numeric := round(coalesce(p_allocation_pct, 0), 2);
  v_bl   uuid    := p_business_line_id;
  v_tipo text;
  v_soma numeric;
  v_id   uuid;
  v_prev jsonb;
BEGIN
  -- Guarda de empresa (mesma régua das demais RPCs de cadastro).
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF v_type NOT IN ('conta', 'texto') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tipo inválido (use conta ou texto)'); END IF;
  IF v_key = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'informe a conta (ex.: 4.02) ou a palavra (ex.: IPTU)'); END IF;
  IF v_type = 'texto' AND char_length(v_key) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'use uma palavra com 3 letras ou mais'); END IF;
  IF NOT (v_pct > 0 AND v_pct <= 100) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'o % vai de 1 a 100'); END IF;
  IF v_type = 'conta' AND NOT EXISTS (
       SELECT 1 FROM erp_plano_contas WHERE company_id = p_company_id AND codigo = v_key) THEN
    RETURN jsonb_build_object('ok', false, 'erro', format('a conta %s não existe no plano de contas', v_key)); END IF;
  IF v_bl IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM business_lines WHERE id = v_bl AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'negócio de outra empresa'); END IF;

  v_tipo := CASE WHEN v_bl IS NULL THEN 'comum' ELSE 'direto' END;

  -- Editar: a linha tem de ser desta empresa e uma regra de conta|texto.
  IF p_id IS NOT NULL THEN
    SELECT jsonb_build_object('business_line_id', business_line_id, 'allocation_pct', allocation_pct,
                              'source_type', source_type, 'source_key', source_key,
                              'tipo_apropriacao', tipo_apropriacao, 'ativo', ativo)
      INTO v_prev
      FROM cost_center_map
     WHERE id = p_id AND company_id = p_company_id AND source_type IN ('conta', 'texto');
    IF v_prev IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'regra não encontrada'); END IF;
  END IF;

  -- Soma por (tipo, chave normalizada) não pode passar de 100, excluindo a própria linha ao editar.
  SELECT coalesce(sum(allocation_pct), 0) INTO v_soma
    FROM cost_center_map
   WHERE company_id = p_company_id AND source_type = v_type
     AND lower(btrim(source_key)) = lower(v_key) AND ativo = true
     AND (p_id IS NULL OR id <> p_id);
  IF v_soma + v_pct > 100.0001 THEN
    RETURN jsonb_build_object('ok', false, 'erro',
      format('"%s" já tem %s%% — com mais %s%% passa de 100%%', v_key, v_soma, v_pct)); END IF;

  -- Mesmo negócio na mesma chave já cadastrado (fora a própria linha): oriente a editar em vez de duplicar.
  IF EXISTS (
       SELECT 1 FROM cost_center_map
        WHERE company_id = p_company_id AND source_type = v_type
          AND lower(btrim(source_key)) = lower(v_key) AND ativo = true
          AND business_line_id IS NOT DISTINCT FROM v_bl
          AND (p_id IS NULL OR id <> p_id)) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'já existe uma regra para esse negócio nessa chave — edite-a'); END IF;

  IF p_id IS NULL THEN
    INSERT INTO cost_center_map (company_id, source_type, source_key, business_line_id, tipo_apropriacao,
                                 allocation_pct, cost_scope, priority, ativo)
    VALUES (p_company_id, v_type, v_key, v_bl, v_tipo, v_pct, 'todos', 0, true)
    RETURNING id INTO v_id;
  ELSE
    UPDATE cost_center_map
       SET business_line_id = v_bl, tipo_apropriacao = v_tipo, allocation_pct = v_pct, updated_at = now()
     WHERE id = p_id AND company_id = p_company_id
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'cost_center_map', v_id::text,
          CASE WHEN p_id IS NULL THEN 'regra_rateio_criar' ELSE 'regra_rateio_editar' END,
          v_prev,
          jsonb_build_object('source_type', v_type, 'source_key', v_key, 'business_line_id', v_bl,
                             'tipo_apropriacao', v_tipo, 'allocation_pct', v_pct, 'ativo', true));

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_ge_regra_rateio_salvar(uuid, text, text, uuid, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_regra_rateio_salvar(uuid, text, text, uuid, numeric, uuid) TO authenticated, service_role;

-- ── Excluir regra de rateio — SOFT-DELETE + audit (RD-98 p4) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ge_regra_rateio_excluir(p_company_id uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_prev jsonb;
  v_n    int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;

  SELECT jsonb_build_object('source_type', source_type, 'source_key', source_key,
                            'business_line_id', business_line_id, 'allocation_pct', allocation_pct, 'ativo', ativo)
    INTO v_prev
    FROM cost_center_map
   WHERE id = p_id AND company_id = p_company_id AND source_type IN ('conta', 'texto');
  IF v_prev IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'regra não encontrada'); END IF;

  UPDATE cost_center_map SET ativo = false, updated_at = now()
   WHERE id = p_id AND company_id = p_company_id AND ativo = true;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RETURN jsonb_build_object('ok', true, 'ja_inativo', true); END IF;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'cost_center_map', p_id::text,
          'regra_rateio_excluir', v_prev, jsonb_build_object('ativo', false));

  RETURN jsonb_build_object('ok', true, 'inativada', true);
END $function$;
REVOKE ALL ON FUNCTION public.fn_ge_regra_rateio_excluir(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_regra_rateio_excluir(uuid, uuid) TO authenticated, service_role;
