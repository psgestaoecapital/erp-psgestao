-- BI AGRO Fase 1 — RPCs das 3 telas de detalhe (custo/rebanho/pasto). SECURITY DEFINER, guard de escopo.
-- RD-58: só devolve o que tem lastro; o front declara "em breve" onde a fonte está vazia (pirâmide etária
-- sem data_nascimento; evolução com <2 meses). Pilar 1: custo/DRE só LÊ de erp_pagar (GE), não duplica.
-- UA_total reutilizado: sum(count_por_categoria × erp_pec_categoria_ua.ua_valor).

-- 1) CUSTO E RESULTADO
CREATE OR REPLACE FUNCTION public.fn_agro_custo_resultado(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ok boolean := (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
  v_total numeric := 0; v_dir numeric := 0; v_ua numeric := 0; v_cab int := 0;
  v_centro jsonb := '[]'; v_cat jsonb := '[]'; v_mes jsonb := '[]';
BEGIN
  IF NOT v_ok THEN RETURN jsonb_build_object('kpis', jsonb_build_object('custo_total',0,'custo_dir_gado',0,'ua_total',0,'cabecas',0,'custo_por_ua',0,'custo_por_cabeca',0),'por_centro','[]'::jsonb,'por_categoria','[]'::jsonb,'por_mes','[]'::jsonb); END IF;
  SELECT COALESCE(sum(valor),0), COALESCE(sum(valor) FILTER (WHERE centro_custo='DIR_GADO'),0) INTO v_total, v_dir FROM erp_pagar WHERE company_id=p_company_id;
  SELECT COALESCE(sum(a.qt*COALESCE(cu.ua_valor,0)),0) INTO v_ua
    FROM (SELECT categoria, count(*) qt FROM erp_pec_animal WHERE company_id=p_company_id GROUP BY categoria) a
    LEFT JOIN erp_pec_categoria_ua cu ON cu.categoria=a.categoria AND cu.company_id=p_company_id;
  SELECT count(*) INTO v_cab FROM erp_pec_animal WHERE company_id=p_company_id;
  SELECT jsonb_agg(jsonb_build_object('centro_custo',COALESCE(centro_custo,'(sem centro)'),'total',round(t))) INTO v_centro
    FROM (SELECT centro_custo, sum(valor) t FROM erp_pagar WHERE company_id=p_company_id GROUP BY centro_custo ORDER BY 2 DESC) s;
  SELECT jsonb_agg(jsonb_build_object('categoria',COALESCE(categoria,'(sem categoria)'),'total',round(t))) INTO v_cat
    FROM (SELECT categoria, sum(valor) t FROM erp_pagar WHERE company_id=p_company_id GROUP BY categoria ORDER BY 2 DESC) s;
  SELECT jsonb_agg(jsonb_build_object('mes',mes,'total',round(t))) INTO v_mes
    FROM (SELECT to_char(date_trunc('month',data_competencia),'YYYY-MM') mes, sum(valor) t FROM erp_pagar WHERE company_id=p_company_id AND data_competencia IS NOT NULL GROUP BY 1 ORDER BY 1) s;
  RETURN jsonb_build_object(
    'kpis', jsonb_build_object('custo_total',round(v_total),'custo_dir_gado',round(v_dir),'ua_total',round(v_ua),
      'cabecas',v_cab,'custo_por_ua',CASE WHEN v_ua>0 THEN round(v_dir/v_ua) ELSE 0 END,
      'custo_por_cabeca',CASE WHEN v_cab>0 THEN round(v_dir/v_cab) ELSE 0 END),
    'por_centro',COALESCE(v_centro,'[]'::jsonb),'por_categoria',COALESCE(v_cat,'[]'::jsonb),'por_mes',COALESCE(v_mes,'[]'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public.fn_agro_custo_resultado(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_agro_custo_resultado(uuid) TO authenticated;

-- 2) REBANHO E INVENTÁRIO
CREATE OR REPLACE FUNCTION public.fn_agro_rebanho(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ok boolean := (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
  v_cab int := 0; v_ua numeric := 0; v_lotes int := 0; v_cats int := 0;
  v_cat jsonb := '[]'; v_sexo jsonb := '[]'; v_lote jsonb := '[]'; v_pir jsonb := '[]'; v_evo jsonb := '[]';
BEGIN
  IF NOT v_ok THEN RETURN jsonb_build_object('kpis',jsonb_build_object('cabecas',0,'ua_total',0,'lotes',0,'categorias',0),'por_categoria','[]'::jsonb,'por_sexo','[]'::jsonb,'por_lote','[]'::jsonb,'piramide_etaria','[]'::jsonb,'evolucao','[]'::jsonb); END IF;
  SELECT count(*), count(DISTINCT lote_id), count(DISTINCT categoria) INTO v_cab, v_lotes, v_cats FROM erp_pec_animal WHERE company_id=p_company_id;
  SELECT COALESCE(sum(a.qt*COALESCE(cu.ua_valor,0)),0) INTO v_ua
    FROM (SELECT categoria, count(*) qt FROM erp_pec_animal WHERE company_id=p_company_id GROUP BY categoria) a
    LEFT JOIN erp_pec_categoria_ua cu ON cu.categoria=a.categoria AND cu.company_id=p_company_id;
  SELECT jsonb_agg(jsonb_build_object('categoria',COALESCE(categoria,'(sem)'),'qt',qt)) INTO v_cat
    FROM (SELECT categoria, count(*) qt FROM erp_pec_animal WHERE company_id=p_company_id GROUP BY categoria ORDER BY 2 DESC) s;
  SELECT jsonb_agg(jsonb_build_object('sexo',COALESCE(sexo,'(sem)'),'qt',qt)) INTO v_sexo
    FROM (SELECT sexo, count(*) qt FROM erp_pec_animal WHERE company_id=p_company_id GROUP BY sexo ORDER BY 2 DESC) s;
  SELECT jsonb_agg(jsonb_build_object('rotulo',rotulo,'qt',qt)) INTO v_lote
    FROM (SELECT COALESCE(l.codigo,'Lote '||right(a.lote_id::text,4)) rotulo, count(*) qt
          FROM erp_pec_animal a LEFT JOIN erp_pec_lote l ON l.id=a.lote_id
          WHERE a.company_id=p_company_id AND a.lote_id IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 20) s;
  -- pirâmide só p/ quem tem data_nascimento (hoje vazio → [] → front declara "em breve")
  SELECT jsonb_agg(jsonb_build_object('faixa',faixa,'qt',qt)) INTO v_pir
    FROM (SELECT CASE WHEN meses<12 THEN '0-12m' WHEN meses<24 THEN '12-24m' WHEN meses<36 THEN '24-36m' ELSE '>36m' END faixa, count(*) qt
          FROM (SELECT (extract(year FROM age(now(),data_nascimento))*12 + extract(month FROM age(now(),data_nascimento))) meses
                FROM erp_pec_animal WHERE company_id=p_company_id AND data_nascimento IS NOT NULL) a GROUP BY 1) s;
  -- evolução: entrada(compra/nascimento) vs saída(venda/morte/abate); transferência é interna (ignora)
  SELECT jsonb_agg(jsonb_build_object('mes',mes,'entradas',ent,'saidas',sai,'saldo',ent-sai)) INTO v_evo
    FROM (SELECT to_char(date_trunc('month',data),'YYYY-MM') mes,
            COALESCE(sum(COALESCE(quantidade,1)) FILTER (WHERE tipo IN ('compra','nascimento','entrada')),0)::int ent,
            COALESCE(sum(COALESCE(quantidade,1)) FILTER (WHERE tipo IN ('venda','morte','abate','saida')),0)::int sai
          FROM erp_pec_movimentacao WHERE company_id=p_company_id GROUP BY 1 ORDER BY 1) s;
  RETURN jsonb_build_object('kpis',jsonb_build_object('cabecas',v_cab,'ua_total',round(v_ua),'lotes',v_lotes,'categorias',v_cats),
    'por_categoria',COALESCE(v_cat,'[]'::jsonb),'por_sexo',COALESCE(v_sexo,'[]'::jsonb),'por_lote',COALESCE(v_lote,'[]'::jsonb),
    'piramide_etaria',COALESCE(v_pir,'[]'::jsonb),'evolucao',COALESCE(v_evo,'[]'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public.fn_agro_rebanho(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_agro_rebanho(uuid) TO authenticated;

-- 3) PASTO E LOTAÇÃO
CREATE OR REPLACE FUNCTION public.fn_agro_pasto(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ok boolean := (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
  v_ha numeric := 0; v_cap numeric := 0; v_ua numeric := 0; v_pastos int := 0;
  v_por jsonb := '[]'; v_pa jsonb := '[]';
BEGIN
  IF NOT v_ok THEN RETURN jsonb_build_object('kpis',jsonb_build_object('ha_total',0,'capacidade_ua',0,'ua_atual',0,'lotacao_ua_ha',0,'ocupacao_pct',0,'pastos',0),'por_pasto','[]'::jsonb,'propria_vs_arrendada','[]'::jsonb); END IF;
  SELECT COALESCE(sum(area_ha),0), COALESCE(sum(capacidade_ua),0), count(*) INTO v_ha, v_cap, v_pastos FROM erp_pec_area WHERE company_id=p_company_id;
  SELECT COALESCE(sum(a.qt*COALESCE(cu.ua_valor,0)),0) INTO v_ua
    FROM (SELECT categoria, count(*) qt FROM erp_pec_animal WHERE company_id=p_company_id GROUP BY categoria) a
    LEFT JOIN erp_pec_categoria_ua cu ON cu.categoria=a.categoria AND cu.company_id=p_company_id;
  SELECT jsonb_agg(jsonb_build_object('nome',COALESCE(nome,'(sem nome)'),'area_ha',round(COALESCE(area_ha,0)),'capacidade_ua',round(COALESCE(capacidade_ua,0)))) INTO v_por
    FROM (SELECT nome, area_ha, capacidade_ua FROM erp_pec_area WHERE company_id=p_company_id ORDER BY area_ha DESC NULLS LAST) s;
  SELECT jsonb_agg(jsonb_build_object('tipo',tipo,'ha',round(ha))) INTO v_pa
    FROM (SELECT CASE WHEN arrendada_para IS NULL THEN 'Própria' ELSE 'Arrendada' END tipo, sum(COALESCE(area_ha,0)) ha FROM erp_pec_area WHERE company_id=p_company_id GROUP BY 1) s;
  RETURN jsonb_build_object('kpis',jsonb_build_object('ha_total',round(v_ha),'capacidade_ua',round(v_cap),'ua_atual',round(v_ua),
    'lotacao_ua_ha',CASE WHEN v_ha>0 THEN round(v_ua/v_ha,2) ELSE 0 END,
    'ocupacao_pct',CASE WHEN v_cap>0 THEN round(100*v_ua/v_cap) ELSE 0 END,'pastos',v_pastos),
    'por_pasto',COALESCE(v_por,'[]'::jsonb),'propria_vs_arrendada',COALESCE(v_pa,'[]'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public.fn_agro_pasto(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_agro_pasto(uuid) TO authenticated;
