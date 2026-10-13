-- DASHBOARD-AGRO (Sprint 1) · motor de dados genérico + item de menu.
-- RD-51/RD-58: nada hardcoded — tudo por company_id do contexto (business_lines, financeiro por
-- competência, movimentação de rebanho). Gate padrão in-app (get_user_company_ids OR is_admin).
-- Base temporal = data_competencia (erp_pagar/receber). Atividade liga por linha_negocio = business_lines.name.
-- Validado contra empresa agro real (Geral/Gado/Soja/EXTRA): agregados e séries batem com o banco.

CREATE OR REPLACE FUNCTION public.fn_agro_dashboard(p_company_id uuid, p_data_inicio date, p_data_fim date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_ok boolean := (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
  v_ini date := COALESCE(p_data_inicio, date_trunc('month', CURRENT_DATE)::date);
  v_fim date := COALESCE(p_data_fim, CURRENT_DATE);
  v_m_ini date;
  v_receita numeric; v_despesa numeric;
  v_por_atividade jsonb; v_rec_cat jsonb; v_desp_cat jsonb;
  v_series jsonb; v_series_ativ jsonb; v_series_rebanho jsonb; v_tem_pec boolean;
BEGIN
  IF NOT v_ok THEN RETURN jsonb_build_object('sem_acesso', true); END IF;
  v_m_ini := (date_trunc('month', v_fim) - interval '11 months')::date;

  -- 3.1 Resultado da fazenda (competência, no período)
  SELECT COALESCE(sum(valor),0) INTO v_receita FROM erp_receber
    WHERE company_id=p_company_id AND deleted_at IS NULL AND data_competencia BETWEEN v_ini AND v_fim;
  SELECT COALESCE(sum(valor),0) INTO v_despesa FROM erp_pagar
    WHERE company_id=p_company_id AND deleted_at IS NULL AND data_competencia BETWEEN v_ini AND v_fim;

  -- 3.2 Resultado por atividade (business_lines ativas; join por linha_negocio=name)
  SELECT jsonb_agg(x ORDER BY (x->>'resultado')::numeric DESC) INTO v_por_atividade FROM (
    SELECT jsonb_build_object('name', bl.name, 'cor', bl.cor, 'type', bl.type,
      'receita', COALESCE(r.rec,0), 'despesa', COALESCE(p.desp,0), 'resultado', COALESCE(r.rec,0)-COALESCE(p.desp,0)) AS x
    FROM business_lines bl
    LEFT JOIN (SELECT linha_negocio, sum(valor) rec FROM erp_receber WHERE company_id=p_company_id AND deleted_at IS NULL AND data_competencia BETWEEN v_ini AND v_fim GROUP BY linha_negocio) r ON r.linha_negocio=bl.name
    LEFT JOIN (SELECT linha_negocio, sum(valor) desp FROM erp_pagar   WHERE company_id=p_company_id AND deleted_at IS NULL AND data_competencia BETWEEN v_ini AND v_fim GROUP BY linha_negocio) p ON p.linha_negocio=bl.name
    WHERE bl.company_id=p_company_id AND bl.is_active
  ) s;

  -- 3.3 Receitas/Despesas por categoria (plano de contas)
  SELECT jsonb_agg(jsonb_build_object('categoria',COALESCE(NULLIF(btrim(categoria),''),'(sem categoria)'),'valor',round(t,2)) ORDER BY t DESC) INTO v_rec_cat
    FROM (SELECT categoria, sum(valor) t FROM erp_receber WHERE company_id=p_company_id AND deleted_at IS NULL AND data_competencia BETWEEN v_ini AND v_fim GROUP BY categoria) s;
  SELECT jsonb_agg(jsonb_build_object('categoria',COALESCE(NULLIF(btrim(categoria),''),'(sem categoria)'),'valor',round(t,2)) ORDER BY t DESC) INTO v_desp_cat
    FROM (SELECT categoria, sum(valor) t FROM erp_pagar   WHERE company_id=p_company_id AND deleted_at IS NULL AND data_competencia BETWEEN v_ini AND v_fim GROUP BY categoria) s;

  -- 3.5.1/2 Séries mensais (12 meses até v_fim): receita × despesa × resultado
  WITH meses AS (SELECT generate_series(v_m_ini, date_trunc('month', v_fim)::date, interval '1 month')::date AS m),
  rec AS (SELECT date_trunc('month', data_competencia)::date m, sum(valor) v FROM erp_receber WHERE company_id=p_company_id AND deleted_at IS NULL AND data_competencia>=v_m_ini AND data_competencia<=v_fim GROUP BY 1),
  pag AS (SELECT date_trunc('month', data_competencia)::date m, sum(valor) v FROM erp_pagar   WHERE company_id=p_company_id AND deleted_at IS NULL AND data_competencia>=v_m_ini AND data_competencia<=v_fim GROUP BY 1)
  SELECT jsonb_agg(jsonb_build_object('mes',to_char(meses.m,'YYYY-MM'),'receita',COALESCE(rec.v,0),'despesa',COALESCE(pag.v,0),'resultado',COALESCE(rec.v,0)-COALESCE(pag.v,0)) ORDER BY meses.m)
    INTO v_series FROM meses LEFT JOIN rec ON rec.m=meses.m LEFT JOIN pag ON pag.m=meses.m;

  -- 3.5.3 Receita por atividade ao longo do tempo (uma série por business_line)
  SELECT jsonb_agg(a) INTO v_series_ativ FROM (
    SELECT jsonb_build_object('name', bl.name, 'cor', bl.cor, 'pontos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('mes',to_char(mm.m,'YYYY-MM'),'receita',COALESCE(rr.v,0)) ORDER BY mm.m)
      FROM (SELECT generate_series(v_m_ini, date_trunc('month',v_fim)::date, interval '1 month')::date m) mm
      LEFT JOIN (SELECT date_trunc('month',data_competencia)::date m, sum(valor) v FROM erp_receber WHERE company_id=p_company_id AND deleted_at IS NULL AND linha_negocio=bl.name AND data_competencia>=v_m_ini AND data_competencia<=v_fim GROUP BY 1) rr ON rr.m=mm.m
    ),'[]'::jsonb)) AS a
    FROM business_lines bl WHERE bl.company_id=p_company_id AND bl.is_active
  ) s;

  -- 3.5.4 Evolução do rebanho (líquido acumulado das movimentações) — só se tem pecuária
  v_tem_pec := EXISTS (SELECT 1 FROM erp_pec_animal WHERE company_id=p_company_id);
  IF v_tem_pec THEN
    WITH meses AS (SELECT generate_series(v_m_ini, date_trunc('month',v_fim)::date, interval '1 month')::date m),
    mov AS (SELECT date_trunc('month',data)::date m,
              sum(CASE WHEN tipo IN ('entrada','compra','nascimento','transferencia_entrada') THEN quantidade
                       WHEN tipo IN ('venda','saida','morte','descarte','transferencia_saida') THEN -quantidade ELSE 0 END) liq
            FROM erp_pec_movimentacao WHERE company_id=p_company_id AND deleted_at IS NULL AND COALESCE(estornada,false)=false AND data>=v_m_ini AND data<=v_fim GROUP BY 1),
    serie AS (SELECT meses.m, COALESCE(mov.liq,0) liq, sum(COALESCE(mov.liq,0)) OVER (ORDER BY meses.m) acum FROM meses LEFT JOIN mov ON mov.m=meses.m)
    SELECT jsonb_agg(jsonb_build_object('mes',to_char(m,'YYYY-MM'),'liquido',liq,'acumulado',acum) ORDER BY m) INTO v_series_rebanho FROM serie;
  END IF;

  RETURN jsonb_build_object(
    'periodo', jsonb_build_object('inicio',v_ini,'fim',v_fim),
    'resultado_fazenda', jsonb_build_object('receita',round(v_receita,2),'despesa',round(v_despesa,2),'resultado',round(v_receita-v_despesa,2)),
    'por_atividade', COALESCE(v_por_atividade,'[]'::jsonb),
    'receitas_por_categoria', COALESCE(v_rec_cat,'[]'::jsonb),
    'despesas_por_categoria', COALESCE(v_desp_cat,'[]'::jsonb),
    'series_mensais', COALESCE(v_series,'[]'::jsonb),
    'series_por_atividade', COALESCE(v_series_ativ,'[]'::jsonb),
    'tem_pecuaria', v_tem_pec,
    'series_rebanho', COALESCE(v_series_rebanho,'[]'::jsonb)
  );
END $fn$;

REVOKE ALL ON FUNCTION public.fn_agro_dashboard(uuid,date,date) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_agro_dashboard(uuid,date,date) TO authenticated;

-- Item de menu "Dashboard" no topo do Agro, sozinho (fora do subgrupo Pecuária).
-- Mesmo grupo='agro' dos demais; subgrupo=null (não entra em "Pecuária"); ordem 0 (topo). Idempotente.
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, rota, ordem, ativo, icone, descricao)
SELECT 'agro_dashboard', 'Dashboard', 'agro', NULL, '/dashboard/agro/dashboard', 0, true, 'LayoutDashboard',
       'Visão geral da fazenda: resultado por atividade, categorias, patrimônio e evolução no tempo.'
WHERE NOT EXISTS (SELECT 1 FROM public.module_catalog WHERE id='agro_dashboard' OR rota='/dashboard/agro/dashboard');

-- Status real (RD-58): sem linha em feature_catalog o sidebar mostra "Previsto" (enganoso). Entregue = 'pronto'.
INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto)
SELECT 'agro_dashboard', 'agro_dashboard', 'agro', 'Dashboard do Agro',
       'Visão geral da fazenda (resultado por atividade, categorias, patrimônio e evolução no tempo).', 'pronto', 100
WHERE NOT EXISTS (SELECT 1 FROM public.feature_catalog WHERE module_id='agro_dashboard');
