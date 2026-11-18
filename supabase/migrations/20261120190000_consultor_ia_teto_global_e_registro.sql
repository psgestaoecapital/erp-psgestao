-- Consultor IA (CEO 18/11): teto de custo REAL de US$ 2/dia e US$ 60/mês para TODAS as empresas somadas,
-- e registro de gasto que de fato grava.
--
-- Achados (provados no banco de produção em 18/11, RD-38):
--  (1) fn_ia_empresa_registrar_gasto é chamada pela rota /api/consultor-ia com a conexão de SERVIÇO. Dentro dela,
--      auth.uid() é NULL → get_user_company_ids() vazio e is_admin() falso → RETURN sem gravar. Resultado:
--      ia_consumo_empresa tem ZERO linhas nos últimos 30 dias e o teto diário nunca dispara.
--      Correção: aceitar service_role (a rota já validou a empresa pela sessão do usuário) e validar a faixa do custo
--      (antes um usuário logado podia mandar custo NEGATIVO e "zerar" o consumo da própria empresa).
--  (2) fn_ia_global_pode_gastar só conhecia US$ 2/dia fixo e não tinha teto MENSAL. O consultor_ia está na allowlist
--      (features_liberadas) e por isso pula o porteiro global do anthropic_budget_control. Correção: lê os limites
--      do próprio anthropic_budget_control (dia/mês; padrão 2/60) e soma o gasto do consultor AO gasto do resto do
--      sistema no mesmo dia/mês — o teto passa a ser do sistema inteiro, como o CEO pediu.

CREATE OR REPLACE FUNCTION public.fn_ia_empresa_registrar_gasto(p_company_id uuid, p_feature text, p_custo_usd numeric, p_chamadas int DEFAULT 1)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_company_id IS NULL OR COALESCE(btrim(p_feature),'') = '' THEN RETURN; END IF;
  -- custo plausível por chamada (mesma faixa do fn_budget_registrar_gasto); negativo nunca "devolve" orçamento
  IF p_custo_usd IS NULL OR p_custo_usd < 0 OR p_custo_usd > 10 THEN
    RAISE EXCEPTION 'Custo de IA fora da faixa (0–10 USD)' USING ERRCODE = '22023';
  END IF;
  -- service_role: a rota do servidor já validou a empresa pela sessão do usuário (exigirEmpresas).
  IF NOT (auth.role() = 'service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN; END IF;
  INSERT INTO ia_consumo_empresa (company_id, data_referencia, feature, custo_usd, chamadas)
  VALUES (p_company_id, current_date, p_feature, p_custo_usd, GREATEST(COALESCE(p_chamadas,1), 0))
  ON CONFLICT (company_id, data_referencia, feature) DO UPDATE
    SET custo_usd = ia_consumo_empresa.custo_usd + EXCLUDED.custo_usd,
        chamadas = ia_consumo_empresa.chamadas + EXCLUDED.chamadas;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_ia_global_pode_gastar(p_feature text, p_custo_estimado numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_teto_dia numeric := 2.00;   -- US$/dia, GLOBAL (todas as empresas somadas)
  v_teto_mes numeric := 60.00;  -- US$/mês, GLOBAL
  v_outros_dia numeric := 0;    -- gasto do resto do sistema (anthropic_budget_control)
  v_outros_mes numeric := 0;
  v_feat_dia numeric;
  v_feat_mes numeric;
  v_est numeric := GREATEST(COALESCE(p_custo_estimado, 0), 0);
  b record;
BEGIN
  IF COALESCE(btrim(p_feature),'') = '' THEN
    RETURN jsonb_build_object('pode', false, 'motivo', 'feature_ausente', 'consumo', 0, 'teto', v_teto_dia);
  END IF;

  SELECT limite_max_custo_usd_dia, limite_max_custo_usd_mes, custo_usd_hoje, custo_usd_mes_atual, data_hoje, mes_atual
    INTO b FROM anthropic_budget_control WHERE id = 1;
  IF FOUND THEN
    IF COALESCE(b.limite_max_custo_usd_dia, 0) > 0 THEN v_teto_dia := b.limite_max_custo_usd_dia; END IF;
    IF COALESCE(b.limite_max_custo_usd_mes, 0) > 0 THEN v_teto_mes := b.limite_max_custo_usd_mes; END IF;
    IF b.data_hoje = current_date THEN v_outros_dia := COALESCE(b.custo_usd_hoje, 0); END IF;
    IF b.mes_atual = to_char(current_date, 'YYYY-MM') THEN v_outros_mes := COALESCE(b.custo_usd_mes_atual, 0); END IF;
  END IF;

  SELECT COALESCE(SUM(custo_usd) FILTER (WHERE data_referencia = current_date), 0),
         COALESCE(SUM(custo_usd), 0)
    INTO v_feat_dia, v_feat_mes
    FROM ia_consumo_empresa
   WHERE feature = p_feature
     AND data_referencia >= date_trunc('month', current_date)::date;

  IF v_feat_dia + v_outros_dia + v_est > v_teto_dia THEN
    RETURN jsonb_build_object('pode', false, 'motivo', 'teto_diario_global', 'consumo', v_feat_dia + v_outros_dia, 'teto', v_teto_dia);
  END IF;
  IF v_feat_mes + v_outros_mes + v_est > v_teto_mes THEN
    RETURN jsonb_build_object('pode', false, 'motivo', 'teto_mensal_global', 'consumo', v_feat_mes + v_outros_mes, 'teto', v_teto_mes);
  END IF;
  RETURN jsonb_build_object('pode', true, 'consumo', v_feat_dia + v_outros_dia, 'teto', v_teto_dia,
                            'consumo_mes', v_feat_mes + v_outros_mes, 'teto_mes', v_teto_mes);
END $function$;

REVOKE ALL ON FUNCTION public.fn_ia_empresa_registrar_gasto(uuid, text, numeric, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ia_global_pode_gastar(text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ia_empresa_registrar_gasto(uuid, text, numeric, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ia_global_pode_gastar(text, numeric) TO authenticated, service_role;
