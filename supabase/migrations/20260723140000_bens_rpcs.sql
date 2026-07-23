-- RPCs do imobilizado: depreciação (idempotente), baixar/vender, criar-do-pagar,
-- salvar manuais do balanço, listar, e o BALANÇO PATRIMONIAL completo (origem por linha).

CREATE OR REPLACE FUNCTION public.fn_bem_calcular_depreciacao(p_company_id uuid, p_competencia date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_comp date := date_trunc('month', p_competencia)::date; b RECORD;
  v_start date; v_base numeric; v_mensal numeric; v_m int; v_m_prev int;
  v_acum numeric; v_acum_prev numeric; v_valor numeric; v_vc numeric;
  v_proc int := 0; v_dep_total numeric := 0; v_faltando jsonb := '[]'::jsonb; v_pendente jsonb := '[]'::jsonb;
BEGIN
  FOR b IN SELECT * FROM erp_bem WHERE company_id=p_company_id AND status='ativo' AND deprecia=true LOOP
    IF b.metodo_depreciacao <> 'linear' THEN
      v_pendente := v_pendente || jsonb_build_object('bem_id',b.id,'descricao',b.descricao,'metodo',b.metodo_depreciacao); CONTINUE;
    END IF;
    IF b.vida_util_meses IS NULL THEN
      v_faltando := v_faltando || jsonb_build_object('bem_id',b.id,'descricao',b.descricao,'motivo','sem vida_util_meses'); CONTINUE;
    END IF;
    v_start := date_trunc('month', COALESCE(b.data_inicio_depreciacao, b.data_aquisicao))::date;
    v_m := (EXTRACT(YEAR FROM v_comp)::int*12 + EXTRACT(MONTH FROM v_comp)::int)
         - (EXTRACT(YEAR FROM v_start)::int*12 + EXTRACT(MONTH FROM v_start)::int) + 1;
    IF v_m <= 0 THEN CONTINUE; END IF;
    v_base := GREATEST(b.valor_aquisicao - b.valor_residual, 0);
    v_mensal := ROUND(v_base / b.vida_util_meses, 2); v_m_prev := v_m - 1;
    v_acum := CASE WHEN v_m >= b.vida_util_meses THEN v_base ELSE LEAST(ROUND(v_mensal*v_m,2), v_base) END;
    v_acum_prev := CASE WHEN v_m_prev <= 0 THEN 0 WHEN v_m_prev >= b.vida_util_meses THEN v_base ELSE LEAST(ROUND(v_mensal*v_m_prev,2), v_base) END;
    v_valor := ROUND(v_acum - v_acum_prev, 2);
    IF v_valor <= 0 THEN CONTINUE; END IF;
    v_vc := ROUND(b.valor_aquisicao - v_acum, 2);
    INSERT INTO erp_bem_depreciacao (company_id,bem_id,competencia,valor,base_calculo,acumulado,valor_contabil)
    VALUES (p_company_id,b.id,v_comp,v_valor,v_base,v_acum,v_vc)
    ON CONFLICT (bem_id,competencia) DO UPDATE SET valor=EXCLUDED.valor, base_calculo=EXCLUDED.base_calculo, acumulado=EXCLUDED.acumulado, valor_contabil=EXCLUDED.valor_contabil;
    v_proc := v_proc + 1; v_dep_total := v_dep_total + v_valor;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'competencia',v_comp,'bens_depreciados',v_proc,'depreciacao_total',ROUND(v_dep_total,2),'faltando_parametro',v_faltando,'metodo_pendente',v_pendente);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_bem_baixar(p_company_id uuid, p_bem_id uuid, p_tipo text, p_data date, p_valor numeric, p_justificativa text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_bem RECORD; v_acum numeric; v_vc numeric; v_res numeric; v_status text;
BEGIN
  SELECT * INTO v_bem FROM erp_bem WHERE id=p_bem_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','bem não encontrado'); END IF;
  SELECT acumulado INTO v_acum FROM erp_bem_depreciacao WHERE bem_id=p_bem_id AND competencia<=p_data ORDER BY competencia DESC LIMIT 1;
  v_acum := COALESCE(v_acum,0); v_vc := ROUND(v_bem.valor_aquisicao - v_acum,2);
  v_res := CASE WHEN p_tipo='venda' THEN ROUND(p_valor-v_vc,2) WHEN p_tipo IN ('baixa','sinistro') THEN ROUND(-v_vc,2) ELSE NULL END;
  INSERT INTO erp_bem_movimentacao(company_id,bem_id,tipo,data,valor,valor_contabil_na_data,resultado,justificativa)
    VALUES(p_company_id,p_bem_id,p_tipo,p_data,p_valor,v_vc,v_res,p_justificativa);
  v_status := CASE p_tipo WHEN 'venda' THEN 'vendido' WHEN 'baixa' THEN 'baixado' WHEN 'sinistro' THEN 'sinistrado' ELSE v_bem.status END;
  IF p_tipo IN ('venda','baixa','sinistro') THEN UPDATE erp_bem SET status=v_status, updated_at=now() WHERE id=p_bem_id; END IF;
  RETURN jsonb_build_object('ok',true,'valor_contabil',v_vc,'resultado',v_res,'status',v_status);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_bem_criar_do_pagar(p_company_id uuid, p_pagar_id uuid, p_natureza text, p_vida_util_meses int DEFAULT NULL, p_business_line_id uuid DEFAULT NULL, p_centro_custo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_p RECORD; v_bem_id uuid; v_vida int; v_dep boolean; v_conta uuid; v_data date;
BEGIN
  SELECT id INTO v_bem_id FROM erp_bem WHERE company_id=p_company_id AND origem_lancamento_tabela='erp_pagar' AND origem_lancamento_id=p_pagar_id LIMIT 1;
  IF v_bem_id IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'bem_id',v_bem_id,'ja_existia',true); END IF;
  SELECT * INTO v_p FROM erp_pagar WHERE id=p_pagar_id AND company_id=p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','conta a pagar não encontrada'); END IF;
  SELECT vida_util_meses, deprecia INTO v_vida, v_dep FROM erp_bem_natureza_padrao WHERE natureza=p_natureza AND (company_id=p_company_id OR company_id IS NULL) ORDER BY company_id NULLS LAST LIMIT 1;
  v_vida := COALESCE(p_vida_util_meses, v_vida); v_dep := COALESCE(v_dep, true); v_data := COALESCE(v_p.data_pagamento, v_p.data_vencimento);
  SELECT c.id INTO v_conta FROM erp_bem_natureza_padrao np JOIN erp_plano_contas c ON c.codigo=np.conta_sugerida_codigo AND (c.company_id=p_company_id OR c.company_id IS NULL)
    WHERE np.natureza=p_natureza AND (np.company_id=p_company_id OR np.company_id IS NULL) ORDER BY np.company_id NULLS LAST, c.company_id NULLS LAST LIMIT 1;
  INSERT INTO erp_bem(company_id,descricao,natureza,conta_id,data_aquisicao,valor_aquisicao,fornecedor_nome,origem_lancamento_tabela,origem_lancamento_id,deprecia,vida_util_meses,business_line_id,centro_custo,data_inicio_depreciacao)
    VALUES(p_company_id, COALESCE(v_p.descricao,'Bem'), p_natureza, v_conta, v_data, COALESCE(v_p.valor,0), v_p.fornecedor_nome, 'erp_pagar', p_pagar_id, v_dep, v_vida, p_business_line_id, p_centro_custo, v_data) RETURNING id INTO v_bem_id;
  INSERT INTO erp_bem_movimentacao(company_id,bem_id,tipo,data,valor,justificativa) VALUES(p_company_id,v_bem_id,'aquisicao',v_data,COALESCE(v_p.valor,0),'convertido de conta a pagar (investimento)');
  RETURN jsonb_build_object('ok',true,'bem_id',v_bem_id,'vida_util_meses',v_vida,'deprecia',v_dep);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_balanco_salvar_manual(p_company_id uuid, p_periodo text, p_linhas jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE e jsonb; v_n int := 0;
BEGIN
  FOR e IN SELECT * FROM jsonb_array_elements(COALESCE(p_linhas,'[]'::jsonb)) LOOP
    DELETE FROM balanco_patrimonial WHERE company_id=p_company_id AND periodo=p_periodo AND lado=(e->>'lado') AND grupo=(e->>'grupo') AND nome=(e->>'nome');
    INSERT INTO balanco_patrimonial(company_id,lado,grupo,subgrupo,nome,valor,obs,periodo)
      VALUES(p_company_id, e->>'lado', e->>'grupo', e->>'subgrupo', e->>'nome', NULLIF(e->>'valor','')::numeric, e->>'obs', p_periodo);
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'linhas_salvas',v_n);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_bem_listar(p_company_id uuid)
RETURNS TABLE(id uuid, codigo text, descricao text, natureza text, data_aquisicao date, valor_aquisicao numeric,
  deprecia boolean, vida_util_meses int, metodo_depreciacao text, business_line_id uuid, business_line_nome text,
  centro_custo text, status text, dep_acumulada numeric, valor_contabil numeric, falta_parametro boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT b.id, b.codigo, b.descricao, b.natureza, b.data_aquisicao, b.valor_aquisicao, b.deprecia, b.vida_util_meses,
    b.metodo_depreciacao, b.business_line_id, bl.name, b.centro_custo, b.status,
    COALESCE(d.acumulado,0), ROUND(b.valor_aquisicao - COALESCE(d.acumulado,0),2), (b.deprecia AND b.vida_util_meses IS NULL)
  FROM erp_bem b LEFT JOIN business_lines bl ON bl.id=b.business_line_id
  LEFT JOIN LATERAL (SELECT acumulado FROM erp_bem_depreciacao dd WHERE dd.bem_id=b.id ORDER BY dd.competencia DESC LIMIT 1) d ON TRUE
  WHERE b.company_id=p_company_id ORDER BY b.status, b.natureza, b.descricao;
$$;
