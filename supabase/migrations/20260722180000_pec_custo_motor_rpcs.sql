-- Motor de Custo Pecuário Genérico — Fase 2 (RPCs).
-- Fórmula única: custo ÷ produção. O motor não conhece a fase; a fase só troca
-- a UNIDADE de produção (bezerro/@/cabeça.dia). RD-41 · RD-51 (sem dado = NULL c/ motivo).

-- A diluição gera 1 fatia por mês -> a idempotência do rateio é por (lançamento, animal, mês).
DROP INDEX IF EXISTS public.uq_pec_custo_animal_lanc_animal;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pec_custo_animal_lanc_animal_mes
  ON public.erp_pec_custo_animal (origem_lancamento_id, animal_id, data_ref)
  WHERE origem_lancamento_id IS NOT NULL AND tipo = 'apropriado';

-- ── fn_pec_ua_lote: soma UA dos animais ativos do lote na data ──────────────────
CREATE OR REPLACE FUNCTION public.fn_pec_ua_lote(p_company uuid, p_lote uuid, p_data date)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(SUM(COALESCE(cua.ua_valor, 1.0)), 0)::numeric
  FROM erp_pec_animal a
  LEFT JOIN erp_pec_categoria_ua cua ON cua.company_id = a.company_id AND cua.categoria = a.categoria
  WHERE a.company_id = p_company AND a.lote_id = p_lote AND a.ativo = true
    AND (a.data_entrada IS NULL OR a.data_entrada <= p_data)
    AND (a.data_saida IS NULL OR a.data_saida >= p_data);
$$;

-- ── fn_pec_custo_ratear: o coração. direto=100% no lote; comum=rateio por UA;
--    extra=fora; respeita meses_diluicao (fatia mês a mês). Idempotente (delete+insert).
--    Grava erp_pec_custo_animal (apropriado) por animal ∝ UA. Retorna a memória de cálculo.
CREATE OR REPLACE FUNCTION public.fn_pec_custo_ratear(p_company uuid, p_ini date, p_fim date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_lanc int; v_animais int; v_total numeric; v_memoria jsonb;
BEGIN
  -- idempotência: limpa apropriações já feitas cujas fatias caem no período
  DELETE FROM erp_pec_custo_animal
   WHERE company_id = p_company AND tipo = 'apropriado'
     AND data_ref BETWEEN date_trunc('month', p_ini)::date AND p_fim;

  -- fatias (1 por mês de diluição) que intersectam [ini,fim]
  WITH slices AS (
    SELECT l.id AS lanc_id, l.tipo_apropriacao, l.lote_id,
           (l.valor / l.meses_diluicao)::numeric AS slice_val,
           (date_trunc('month', l.data_competencia) + (g || ' month')::interval)::date AS slice_month,
           LEAST(p_fim, (date_trunc('month', l.data_competencia)
                 + (g || ' month')::interval + interval '1 month - 1 day')::date) AS ref_date
    FROM erp_pec_custo_lancamento l
    CROSS JOIN generate_series(0, l.meses_diluicao - 1) AS g
    WHERE l.company_id = p_company
      AND l.tipo_apropriacao IN ('direto','comum')
      AND (date_trunc('month', l.data_competencia) + (g || ' month')::interval)::date <= p_fim
      AND (date_trunc('month', l.data_competencia) + (g || ' month')::interval
           + interval '1 month - 1 day')::date >= p_ini
  ),
  -- animais elegíveis por fatia: direto=animais do lote da fatia; comum=todos da empresa
  elegiveis AS (
    SELECT s.lanc_id, s.slice_val, s.slice_month, s.ref_date,
           a.id AS animal_id, a.lote_id AS animal_lote,
           COALESCE(cua.ua_valor, 1.0) AS animal_ua
    FROM slices s
    JOIN erp_pec_animal a
      ON a.company_id = p_company AND a.ativo = true
     AND ( (s.tipo_apropriacao = 'direto' AND a.lote_id = s.lote_id)
        OR (s.tipo_apropriacao = 'comum'  AND a.lote_id IS NOT NULL) )
     AND (a.data_entrada IS NULL OR a.data_entrada <= s.ref_date)
     AND (a.data_saida  IS NULL OR a.data_saida  >= s.ref_date)
    LEFT JOIN erp_pec_categoria_ua cua ON cua.company_id = a.company_id AND cua.categoria = a.categoria
  ),
  com_total AS (
    SELECT e.*,
           SUM(animal_ua) OVER (PARTITION BY lanc_id, slice_month) AS ua_total
    FROM elegiveis e
  ),
  ins AS (
    INSERT INTO erp_pec_custo_animal
      (company_id, animal_id, lote_id, fase, tipo, valor, data_ref, origem_lancamento_id)
    SELECT p_company, ct.animal_id, ct.animal_lote,
           (SELECT fase FROM erp_pec_lote WHERE id = ct.animal_lote),
           'apropriado',
           ROUND(ct.slice_val * ct.animal_ua / NULLIF(ct.ua_total, 0), 2),
           ct.slice_month, ct.lanc_id
    FROM com_total ct
    WHERE ct.ua_total > 0
    RETURNING lote_id, valor, origem_lancamento_id, animal_id
  )
  SELECT count(DISTINCT origem_lancamento_id), count(DISTINCT animal_id), COALESCE(SUM(valor),0)
    INTO v_lanc, v_animais, v_total
  FROM ins;

  -- memória de cálculo por lote (UA no fim do período, % e valor alocado)
  SELECT COALESCE(jsonb_agg(m ORDER BY (m->>'valor_alocado')::numeric DESC), '[]'::jsonb) INTO v_memoria
  FROM (
    SELECT jsonb_build_object(
      'lote_id', ca.lote_id,
      'lote_codigo', (SELECT codigo FROM erp_pec_lote WHERE id = ca.lote_id),
      'fase', (SELECT fase FROM erp_pec_lote WHERE id = ca.lote_id),
      'ua_lote', fn_pec_ua_lote(p_company, ca.lote_id, p_fim),
      'valor_alocado', ROUND(SUM(ca.valor), 2),
      'pct_do_total', CASE WHEN v_total > 0 THEN ROUND(100 * SUM(ca.valor) / v_total, 2) ELSE 0 END
    ) AS m
    FROM erp_pec_custo_animal ca
    WHERE ca.company_id = p_company AND ca.tipo = 'apropriado'
      AND ca.data_ref BETWEEN date_trunc('month', p_ini)::date AND p_fim
    GROUP BY ca.lote_id
  ) sub;

  RETURN jsonb_build_object(
    'ok', true, 'periodo_ini', p_ini, 'periodo_fim', p_fim,
    'lancamentos_processados', COALESCE(v_lanc,0),
    'animais_afetados', COALESCE(v_animais,0),
    'total_alocado', COALESCE(v_total,0),
    'memoria', v_memoria
  );
END;
$$;

-- ── fn_pec_transferir_fase: custo acumulado acompanha o animal (decisão B) ───────
CREATE OR REPLACE FUNCTION public.fn_pec_transferir_fase(
  p_company uuid, p_animal_ids uuid[], p_lote_destino uuid, p_data date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_animal uuid; v_saldo numeric; v_lote_origem uuid; v_fase_dest text; v_n int := 0; v_total numeric := 0;
BEGIN
  SELECT fase INTO v_fase_dest FROM erp_pec_lote WHERE id = p_lote_destino AND company_id = p_company;
  IF v_fase_dest IS NULL AND NOT EXISTS (SELECT 1 FROM erp_pec_lote WHERE id = p_lote_destino AND company_id = p_company) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'lote_destino inexistente nesta empresa');
  END IF;

  FOREACH v_animal IN ARRAY p_animal_ids LOOP
    SELECT lote_id INTO v_lote_origem FROM erp_pec_animal WHERE id = v_animal AND company_id = p_company;
    IF v_lote_origem IS NULL THEN CONTINUE; END IF;

    -- saldo acumulado do animal (entradas − saídas)
    SELECT COALESCE(SUM(CASE WHEN tipo = 'transferencia_saida' THEN -valor ELSE valor END), 0)
      INTO v_saldo
    FROM erp_pec_custo_animal
    WHERE company_id = p_company AND animal_id = v_animal;

    INSERT INTO erp_pec_custo_animal (company_id, animal_id, lote_id, fase, tipo, valor, data_ref)
    VALUES (p_company, v_animal, v_lote_origem,
            (SELECT fase FROM erp_pec_lote WHERE id = v_lote_origem),
            'transferencia_saida', v_saldo, p_data);
    INSERT INTO erp_pec_custo_animal (company_id, animal_id, lote_id, fase, tipo, valor, data_ref)
    VALUES (p_company, v_animal, p_lote_destino, v_fase_dest, 'transferencia_entrada', v_saldo, p_data);

    UPDATE erp_pec_animal SET lote_id = p_lote_destino, updated_at = now()
     WHERE id = v_animal AND company_id = p_company;

    INSERT INTO erp_pec_producao_evento (company_id, lote_id, animal_id, tipo, data, quantidade, unidade, observacao)
    VALUES (p_company, p_lote_destino, v_animal, 'transferencia_fase', p_data, 1, 'cabeca',
            'transferência de fase; custo acumulado R$ ' || v_saldo::text);

    v_n := v_n + 1; v_total := v_total + v_saldo;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'animais_transferidos', v_n,
    'lote_destino', p_lote_destino, 'custo_acumulado_movido', ROUND(v_total, 2));
END;
$$;

-- ── fn_pec_indicador_custo: indicador da fase (custo ÷ produção). NULL c/ motivo. ─
CREATE OR REPLACE FUNCTION public.fn_pec_indicador_custo(
  p_company uuid, p_lote uuid, p_ini date, p_fim date, p_kg_por_arroba numeric DEFAULT 15)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_fase text; v_custo numeric; v_dias int; v_n_animais int;
  v_desmamados numeric; v_matrizes int; v_kg_ganho numeric; v_arrobas numeric; v_gmd numeric;
BEGIN
  SELECT fase INTO v_fase FROM erp_pec_lote WHERE id = p_lote AND company_id = p_company;
  IF v_fase IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'lote inexistente nesta empresa');
  END IF;

  v_dias := GREATEST((p_fim - p_ini) + 1, 1);

  -- custo do lote no período (apropriado + aquisição + entradas − saídas)
  SELECT COALESCE(SUM(CASE WHEN tipo = 'transferencia_saida' THEN -valor ELSE valor END), 0)
    INTO v_custo
  FROM erp_pec_custo_animal
  WHERE company_id = p_company AND lote_id = p_lote
    AND data_ref BETWEEN date_trunc('month', p_ini)::date AND p_fim;

  v_n_animais := (SELECT count(*) FROM erp_pec_animal
                  WHERE company_id = p_company AND lote_id = p_lote AND ativo = true);

  IF v_fase = 'cria' THEN
    SELECT COALESCE(SUM(quantidade), 0) INTO v_desmamados
    FROM erp_pec_producao_evento
    WHERE company_id = p_company AND lote_id = p_lote AND tipo = 'desmame'
      AND unidade = 'cabeca' AND data BETWEEN p_ini AND p_fim;
    v_matrizes := (SELECT count(*) FROM erp_pec_animal
                   WHERE company_id = p_company AND lote_id = p_lote AND ativo = true AND categoria = 'matriz');
    IF v_desmamados IS NULL OR v_desmamados = 0 THEN
      RETURN jsonb_build_object('ok', true, 'fase', v_fase, 'indicador', NULL,
        'custo_total', ROUND(v_custo,2),
        'motivo', 'sem desmame registrado no período — não dá pra calcular custo por bezerro (RD-51)');
    END IF;
    RETURN jsonb_build_object('ok', true, 'fase', v_fase, 'unidade_producao', 'bezerro_desmamado',
      'custo_total', ROUND(v_custo,2),
      'bezerros_desmamados', v_desmamados,
      'custo_por_bezerro', ROUND(v_custo / v_desmamados, 2),
      'matrizes', v_matrizes,
      'taxa_desmame_pct', CASE WHEN v_matrizes > 0 THEN ROUND(100 * v_desmamados / v_matrizes, 1) ELSE NULL END,
      'custo_matriz_ano', CASE WHEN v_matrizes > 0
          THEN ROUND((v_custo * (365.0 / v_dias)) / v_matrizes, 2) ELSE NULL END);
  ELSE
    -- recria/engorda/terminacao: @ produzida = kg ganho / kg_por_arroba
    SELECT COALESCE(SUM(quantidade), 0) INTO v_kg_ganho
    FROM erp_pec_producao_evento
    WHERE company_id = p_company AND lote_id = p_lote AND tipo = 'ganho_peso'
      AND unidade = 'kg' AND data BETWEEN p_ini AND p_fim;

    IF v_kg_ganho IS NULL OR v_kg_ganho = 0 THEN
      -- fallback: deriva do peso (última − primeira pesagem no período) dos animais do lote
      SELECT COALESCE(SUM(ganho), 0) INTO v_kg_ganho FROM (
        SELECT (last_value(p.peso_kg) OVER w - first_value(p.peso_kg) OVER w) AS ganho
        FROM erp_pec_pesagem p
        JOIN erp_pec_animal a ON a.id = p.animal_id AND a.lote_id = p_lote
        WHERE p.company_id = p_company AND p.data BETWEEN p_ini AND p_fim
        WINDOW w AS (PARTITION BY p.animal_id ORDER BY p.data
                     ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
      ) g;
    END IF;

    IF v_kg_ganho IS NULL OR v_kg_ganho = 0 THEN
      RETURN jsonb_build_object('ok', true, 'fase', v_fase, 'indicador', NULL,
        'custo_total', ROUND(v_custo,2),
        'motivo', 'sem pesagem/ganho no período — não dá pra calcular custo por @ (RD-51)');
    END IF;

    v_arrobas := v_kg_ganho / NULLIF(p_kg_por_arroba, 0);
    v_gmd := CASE WHEN v_n_animais > 0 THEN v_kg_ganho / (v_n_animais * v_dias) ELSE NULL END;
    RETURN jsonb_build_object('ok', true, 'fase', v_fase, 'unidade_producao', 'arroba_produzida',
      'custo_total', ROUND(v_custo,2),
      'kg_ganho', ROUND(v_kg_ganho,2),
      'arrobas_produzidas', ROUND(v_arrobas,2),
      'kg_por_arroba', p_kg_por_arroba,
      'custo_por_arroba', CASE WHEN v_arrobas > 0 THEN ROUND(v_custo / v_arrobas, 2) ELSE NULL END,
      'gmd_kg_dia', ROUND(v_gmd, 3),
      'custo_cabeca_dia', CASE WHEN v_n_animais > 0 THEN ROUND(v_custo / (v_n_animais * v_dias), 2) ELSE NULL END,
      'cabecas', v_n_animais);
  END IF;
END;
$$;

-- ── fn_pec_custo_importar_do_pagar: traz do GE, mapeia centro_custo→tipo. Idempotente.
CREATE OR REPLACE FUNCTION public.fn_pec_custo_importar_do_pagar(p_company uuid, p_ini date, p_fim date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ins int;
BEGIN
  WITH cand AS (
    SELECT p.id, p.descricao, p.valor, p.centro_custo, p.categoria,
           COALESCE(p.data_pagamento, p.data_vencimento) AS competencia
    FROM erp_pagar p
    WHERE p.company_id = p_company
      AND COALESCE(p.data_pagamento, p.data_vencimento) BETWEEN p_ini AND p_fim
      AND p.centro_custo IS NOT NULL
      AND (p.centro_custo ~* 'pec|gado|boi|rebanho|pasto|agro|fazenda|bovino')
  ),
  ins AS (
    INSERT INTO erp_pec_custo_lancamento
      (company_id, lote_id, tipo_apropriacao, categoria, descricao, valor, data_competencia,
       origem, origem_ref_id, observacao)
    SELECT p_company, NULL,
      CASE WHEN centro_custo ~* 'direto' THEN 'direto'
           WHEN centro_custo ~* 'extra'  THEN 'extra'
           ELSE 'comum' END,
      CASE WHEN categoria ~* 'nutri|ração|racao|sal|milho|silag' THEN 'nutricao'
           WHEN categoria ~* 'sanid|vacin|vermi|medic|veterin'    THEN 'sanidade'
           WHEN categoria ~* 'reprod|insemin|semen|touro'         THEN 'reproducao'
           WHEN categoria ~* 'mao|salario|folha|funcion'          THEN 'mao_obra'
           WHEN categoria ~* 'pasto|pastagem|semente|aduba'       THEN 'pastagem'
           WHEN categoria ~* 'arrend'                              THEN 'arrendamento'
           WHEN categoria ~* 'maquin|trator|combust|diesel'       THEN 'maquinas'
           WHEN categoria ~* 'admin|contab|escrit'                THEN 'administrativo'
           ELSE 'outro' END,
      COALESCE(descricao, 'Importado do financeiro'), COALESCE(valor, 0), competencia,
      'erp_pagar', id::text, 'importado de erp_pagar (centro_custo: ' || centro_custo || ')'
    FROM cand
    ON CONFLICT (company_id, origem, origem_ref_id) WHERE origem_ref_id IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_ins FROM ins;

  RETURN jsonb_build_object('ok', true, 'importados', COALESCE(v_ins,0),
    'periodo_ini', p_ini, 'periodo_fim', p_fim,
    'nota', 'tipo_apropriacao inferido do centro_custo (direto/extra/comum). Revise no módulo antes de ratear.');
END;
$$;
