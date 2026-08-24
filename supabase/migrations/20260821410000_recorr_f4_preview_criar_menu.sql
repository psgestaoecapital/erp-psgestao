-- RECORR-F4 · Tela nova de Recorrências PS (aditiva). Backend: preview de cronograma + criar contrato
-- de recorrência (receita de serviço) + item de menu. Reusa o motor erp_contratos (RD-26). NÃO altera
-- nada existente (RD-30/RD-53).

-- 1) Preview do cronograma (sem efeito colateral) — o elemento-assinatura do wizard.
CREATE OR REPLACE FUNCTION public.fn_contrato_preview_cronograma(p_company_id uuid, p_params jsonb, p_n int DEFAULT 6)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_valor numeric := COALESCE((p_params->>'valor')::numeric, 0);
  v_dia int := COALESCE(NULLIF(p_params->>'dia_geracao','')::int, 10);
  v_ini date := COALESCE(NULLIF(p_params->>'data_inicio','')::date, CURRENT_DATE);
  v_per text := COALESCE(NULLIF(p_params->>'periodicidade',''), 'mensal');
  v_passo int := CASE v_per WHEN 'mensal' THEN 1 WHEN 'bimestral' THEN 2 WHEN 'trimestral' THEN 3 WHEN 'semestral' THEN 6 WHEN 'anual' THEN 12 ELSE 1 END;
  v_natureza text := COALESCE(NULLIF(p_params->>'natureza',''), 'receita');
  v_reaj jsonb := COALESCE(p_params->'reajuste', '{}'::jsonb);
  v_reaj_mes int := NULLIF(v_reaj->>'mes','')::int;
  v_reaj_pct numeric := COALESCE(NULLIF(v_reaj->>'pct','')::numeric, 0);
  v_out jsonb := '[]'::jsonb;
  i int; v_mes date; v_venc date; v_val numeric; v_reajustado boolean := false; v_aplica boolean;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  FOR i IN 0 .. GREATEST(COALESCE(p_n,6),1) - 1 LOOP
    v_mes  := (date_trunc('month', v_ini) + (i * v_passo || ' months')::interval)::date;
    v_venc := (v_mes + (COALESCE(v_dia,10) - 1) * interval '1 day')::date;
    v_aplica := (v_reaj_mes IS NOT NULL AND v_reaj_pct <> 0 AND EXTRACT(MONTH FROM v_mes)::int = v_reaj_mes AND i > 0);
    IF v_aplica THEN v_reajustado := true; END IF;
    v_val := CASE WHEN v_reajustado THEN round(v_valor * (1 + v_reaj_pct/100), 2) ELSE round(v_valor, 2) END;
    v_out := v_out || jsonb_build_object('data', v_venc, 'valor', v_val, 'com_reajuste', v_aplica,
      'o_que_gera', CASE WHEN v_natureza = 'despesa' THEN 'Conta a pagar' ELSE 'Conta a receber' END);
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'periodicidade', v_per, 'competencias', v_out);
END $fn$;

-- 2) Criar contrato de recorrência (insere em erp_contratos; o cron/gerar_* gera as competências).
CREATE OR REPLACE FUNCTION public.fn_contrato_recorrencia_criar(p_campos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_company uuid := NULLIF(p_campos->>'company_id','')::uuid; v_id uuid; v_numero varchar; v_ini date; v_dia int;
BEGIN
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','company_id_ausente'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF COALESCE((p_campos->>'valor_mensal')::numeric,0) <= 0 THEN
    RETURN jsonb_build_object('ok',false,'erro','valor_obrigatorio'); END IF;
  v_numero := next_contrato_numero(v_company);
  v_ini := COALESCE(NULLIF(p_campos->>'data_inicio','')::date, CURRENT_DATE);
  v_dia := COALESCE(NULLIF(p_campos->>'dia_vencimento','')::int, 10);
  INSERT INTO erp_contratos (company_id, numero, cliente_id, cliente_nome, cliente_cnpj, cliente_email, cliente_telefone,
    tipo, nome, descricao, valor_mensal, valor_atual, data_inicio, data_fim, data_primeiro_vencimento, dia_vencimento,
    periodicidade, tipo_reajuste, reajuste_percentual, mes_reajuste, forma_pagamento, status, natureza, created_by)
  VALUES (v_company, v_numero, NULLIF(p_campos->>'cliente_id','')::uuid, NULLIF(btrim(p_campos->>'cliente_nome'),''),
    NULLIF(btrim(p_campos->>'cliente_cnpj'),''), NULLIF(btrim(p_campos->>'cliente_email'),''), NULLIF(btrim(p_campos->>'cliente_telefone'),''),
    COALESCE(NULLIF(btrim(p_campos->>'tipo'),''),'servico'),
    COALESCE(NULLIF(btrim(p_campos->>'nome'),''), 'Recorrência ' || v_numero),
    NULLIF(p_campos->>'descricao',''),
    COALESCE((p_campos->>'valor_mensal')::numeric,0), COALESCE((p_campos->>'valor_mensal')::numeric,0),
    v_ini, NULLIF(p_campos->>'data_fim','')::date,
    (date_trunc('month', v_ini) + (v_dia-1)*interval '1 day')::date, v_dia,
    COALESCE(NULLIF(p_campos->>'periodicidade',''),'mensal'),
    NULLIF(p_campos->>'tipo_reajuste',''), NULLIF(p_campos->>'reajuste_percentual','')::numeric, NULLIF(p_campos->>'mes_reajuste','')::int,
    NULLIF(p_campos->>'forma_pagamento',''), 'ativo', COALESCE(NULLIF(p_campos->>'natureza',''),'receita'), auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'contrato_id', v_id, 'numero', v_numero);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_contrato_preview_cronograma(uuid,jsonb,int) FROM anon;
REVOKE ALL ON FUNCTION public.fn_contrato_recorrencia_criar(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_preview_cronograma(uuid,jsonb,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_contrato_recorrencia_criar(jsonb) TO authenticated;

-- 3) Item de menu (aditivo) na aba Contratos & Vendas — espelha ge_cadastros_contratos_recorrentes.
INSERT INTO module_catalog (id, nome, grupo, rota, ordem, ativo, descricao, is_shared, subgrupo, diferencial, icone)
VALUES ('ge_recorrencias_ps', 'Recorrências PS', 'gestao_empresarial', '/dashboard/contratos/recorrencias-ps', 15, true,
  'Nova recorrência (wizard + preview de cronograma) · receita recorrente de serviço', true, 'contratos_vendas', true, 'Repeat')
ON CONFLICT (id) DO NOTHING;
