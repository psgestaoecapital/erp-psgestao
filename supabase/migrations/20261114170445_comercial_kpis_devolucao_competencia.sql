-- Painel de vendas / KPIs comerciais — devolução do faturamento líquido POR COMPETÊNCIA (CEO 12/11, caixa d31f1966).
-- Problema (achado no dado): a devolução do faturamento líquido era casada pela DATA_MOVTO (data de LANÇAMENTO).
-- Há 45 devoluções T582 lançadas no INÍCIO de NOVEMBRO que são de vendas de OUTUBRO; pela data de lançamento elas
-- não entravam no fechamento de outubro, afastando o líquido do relatório do ATAK.
--
-- Correção (aditiva, só reescreve a função de leitura; não toca dado de cliente):
-- a devolução passa a ser atribuída por COMPETÊNCIA — devoluções lançadas nos primeiros N dias de um mês contam no
-- fechamento do MÊS ANTERIOR. Regra uniforme (não assimétrica): assim uma mesma devolução nunca conta em dois meses.
--   eff := se dia(DATA_MOVTO) <= N  -> último dia do mês anterior ;  senão -> a própria DATA_MOVTO
--   a devolução entra no período [p_dt_ini, p_dt_fim] quando eff cai dentro do período.
-- N (dia de corte) é um parâmetro do cálculo (constante nomeada v_dia_corte; default 5). Vira configurável por empresa
-- numa próxima rodada, se o Eng. Chefe confirmar — aqui fica o default para a leitura de outubro/2026 da Frioeste.
--
-- Só a DEVOLUÇÃO que abate o faturamento muda. O DESCARTE (T131, ainda não integrado) e todo o resto da função
-- (venda bruta, seleção, sem-despojo, tickets) seguem IDÊNTICOS. Fonte, escopo e filtros de vendedor inalterados.
-- RD-52 (migration só em arquivo) · RD-38 (auditado contra o corpo vivo) · RD-97 (aditiva).

CREATE OR REPLACE FUNCTION public.fn_bi_comercial_kpis(p_company_id uuid, p_dt_ini date, p_dt_fim date, p_vendedor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope jsonb; v_vend text; r RECORD;
  v_tipos_dev  text[];
  v_tipos_desc text[];
  v_dev_valor  numeric := 0;
  v_dev_kg     numeric := 0;
  v_dev_tipos  jsonb   := '[]'::jsonb;
  v_desc_valor numeric := 0;
  v_desc_kg    numeric := 0;
  v_desc_linhas int    := 0;
  v_desc_prod  jsonb   := '[]'::jsonb;
  v_desc_vend  jsonb   := '[]'::jsonb;
  v_desc_linha jsonb   := '[]'::jsonb;
  v_dia_corte  int     := 5;  -- competência: devolução lançada até o dia N conta no mês anterior.
BEGIN
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' = 'sem_acesso' THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial'); END IF;
  v_vend := CASE WHEN v_scope->>'modo' = 'vendedor' THEN v_scope->>'cod' ELSE p_vendedor END;

  -- Venda (BRUTO) — fonte e filtros inalterados.
  SELECT COALESCE(SUM(m.kg), 0) AS volume_kg,
         COALESCE(SUM(m.valor), 0) AS faturamento,
         COUNT(DISTINCT m.cliente_cod) AS clientes,
         COUNT(DISTINCT upper(translate(split_part(m.cidade, '/', 1), 'ÁÀÂÃÉÈÊÍÌÓÒÔÕÚÙÇáàâãéèêíìóòôõúùç', 'AAAAEEEIIOOOUUCaaaaeeeiiooouuc'))) AS cidades,
         COALESCE(SUM(m.kg) FILTER (WHERE c.status = 'entra'), 0) AS kg_com_selecao,
         COALESCE(SUM(m.valor) FILTER (WHERE c.status = 'entra'), 0) AS faturamento_com_selecao,
         COALESCE(SUM(m.valor) FILTER (WHERE m.carne), 0) AS faturamento_sem_despojo,
         COALESCE(SUM(m.kg) FILTER (WHERE m.carne), 0) AS volume_kg_sem_despojo
    INTO r
    FROM public.bi_comercial_venda_item_mv m
    LEFT JOIN public.bi_comercial_produto_classificacao c ON c.company_id = m.company_id AND c.cod_produto = m.produto_cod
   WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini AND p_dt_fim
     AND (v_vend IS NULL OR m.vendedor = v_vend);

  -- Tipos configurados (por empresa com fallback global).
  SELECT array_agg(cod_tipo_mv) INTO v_tipos_dev
    FROM public.fn_comercial_tipos_efetivos(p_company_id, 'devolucao_abate');
  SELECT array_agg(cod_tipo_mv) INTO v_tipos_desc
    FROM public.fn_comercial_tipos_efetivos(p_company_id, 'descarte');

  -- DEVOLUÇÕES que abatem (domínio comercial_devolucao). Mesmos filtros do BI + MESMO escopo de vendedor.
  -- MUDANÇA (d31f1966): o período passa a casar por COMPETÊNCIA (eff), não pela data de lançamento crua.
  -- valor = VALOR_LIQUIDO_ITEM, kg = QTDE_PRI quando KG; STATUS<>'C' inalterado.
  IF v_tipos_dev IS NOT NULL AND cardinality(v_tipos_dev) > 0 THEN
    WITH d AS (
      SELECT f.raw->>'COD_TIPO_MV' AS cod,
             (f.raw->>'VALOR_LIQUIDO_ITEM')::numeric AS valor,
             CASE WHEN trim(f.raw->>'COD_UNIDADE_PRI') = 'KG'
                  THEN COALESCE((f.raw->>'QTDE_PRI')::numeric, 0) ELSE 0 END AS kg
      FROM public.ind_atak_fato f
      CROSS JOIN LATERAL (
        SELECT CASE WHEN left(f.raw->>'DATA_MOVTO', 10) ~ '^\d{4}-\d{2}-\d{2}$'
                    THEN (left(f.raw->>'DATA_MOVTO', 10))::date END AS dm
      ) g
      CROSS JOIN LATERAL (
        SELECT CASE
                 WHEN g.dm IS NULL THEN NULL
                 WHEN extract(day FROM g.dm) <= v_dia_corte THEN (date_trunc('month', g.dm)::date - 1)
                 ELSE g.dm END AS eff
      ) e
      WHERE f.company_id = p_company_id AND f.dominio = 'comercial_devolucao'
        AND trim(f.raw->>'STATUS') <> 'C'
        AND e.eff IS NOT NULL
        AND e.eff >= p_dt_ini AND e.eff <= p_dt_fim
        AND f.raw->>'COD_TIPO_MV' = ANY (v_tipos_dev)
        AND (v_vend IS NULL OR COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'), ''), 's/v') = v_vend)
    )
    SELECT round(COALESCE(sum(valor), 0), 2),
           round(COALESCE(sum(kg), 0), 3),
           COALESCE(jsonb_agg(jsonb_build_object('cod', cod, 'valor', valor, 'kg', kg) ORDER BY cod), '[]'::jsonb)
      INTO v_dev_valor, v_dev_kg, v_dev_tipos
      FROM (SELECT cod, round(sum(valor), 2) valor, round(sum(kg), 3) kg FROM d GROUP BY cod) z;
  END IF;

  -- DESCARTE / PERDA (indicador separado — NÃO abate do faturamento). Hoje T131 ainda não vem. INALTERADO (data de lançamento).
  IF v_tipos_desc IS NOT NULL AND cardinality(v_tipos_desc) > 0 THEN
    SELECT COALESCE(round(sum((f.raw->>'VALOR_LIQUIDO_ITEM')::numeric), 2), 0),
           COALESCE(round(sum(CASE WHEN trim(f.raw->>'COD_UNIDADE_PRI') = 'KG' THEN COALESCE((f.raw->>'QTDE_PRI')::numeric, 0) ELSE 0 END), 3), 0),
           count(*)
      INTO v_desc_valor, v_desc_kg, v_desc_linhas
      FROM public.ind_atak_fato f
      WHERE f.company_id = p_company_id AND f.dominio = 'comercial_devolucao'
        AND trim(f.raw->>'STATUS') <> 'C'
        AND left(f.raw->>'DATA_MOVTO', 10) BETWEEN to_char(p_dt_ini, 'YYYY-MM-DD') AND to_char(p_dt_fim, 'YYYY-MM-DD')
        AND f.raw->>'COD_TIPO_MV' = ANY (v_tipos_desc)
        AND (v_vend IS NULL OR COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'), ''), 's/v') = v_vend);

    IF v_desc_linhas > 0 THEN
      -- quebras por produto / vendedor / linha (só quando houver descarte coletado)
      SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'valor')::numeric DESC), '[]'::jsonb) INTO v_desc_prod FROM (
        SELECT jsonb_build_object('produto', produto, 'valor', round(sum(valor),2), 'kg', round(sum(kg),3)) x
        FROM ( SELECT left(trim(f.raw->>'DESC_PRODUTO_NF'),60) produto,
                      (f.raw->>'VALOR_LIQUIDO_ITEM')::numeric valor,
                      CASE WHEN trim(f.raw->>'COD_UNIDADE_PRI')='KG' THEN COALESCE((f.raw->>'QTDE_PRI')::numeric,0) ELSE 0 END kg
               FROM public.ind_atak_fato f
               WHERE f.company_id=p_company_id AND f.dominio='comercial_devolucao' AND trim(f.raw->>'STATUS')<>'C'
                 AND left(f.raw->>'DATA_MOVTO',10) BETWEEN to_char(p_dt_ini,'YYYY-MM-DD') AND to_char(p_dt_fim,'YYYY-MM-DD')
                 AND f.raw->>'COD_TIPO_MV' = ANY (v_tipos_desc)
                 AND (v_vend IS NULL OR COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'),''),'s/v') = v_vend) ) s
        GROUP BY produto ) q;
      SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'valor')::numeric DESC), '[]'::jsonb) INTO v_desc_vend FROM (
        SELECT jsonb_build_object('vendedor', vendedor_nome, 'valor', round(sum(valor),2), 'kg', round(sum(kg),3)) x
        FROM ( SELECT COALESCE(NULLIF(left(trim(f.raw->>'NOME_COMP'),60),''),'s/v') vendedor_nome,
                      (f.raw->>'VALOR_LIQUIDO_ITEM')::numeric valor,
                      CASE WHEN trim(f.raw->>'COD_UNIDADE_PRI')='KG' THEN COALESCE((f.raw->>'QTDE_PRI')::numeric,0) ELSE 0 END kg
               FROM public.ind_atak_fato f
               WHERE f.company_id=p_company_id AND f.dominio='comercial_devolucao' AND trim(f.raw->>'STATUS')<>'C'
                 AND left(f.raw->>'DATA_MOVTO',10) BETWEEN to_char(p_dt_ini,'YYYY-MM-DD') AND to_char(p_dt_fim,'YYYY-MM-DD')
                 AND f.raw->>'COD_TIPO_MV' = ANY (v_tipos_desc)
                 AND (v_vend IS NULL OR COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'),''),'s/v') = v_vend) ) s
        GROUP BY vendedor_nome ) q;
      SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'valor')::numeric DESC), '[]'::jsonb) INTO v_desc_linha FROM (
        SELECT jsonb_build_object('linha', linha, 'valor', round(sum(valor),2), 'kg', round(sum(kg),3)) x
        FROM ( SELECT left(trim(f.raw->>'DESC_DIVISAO'),60) linha,
                      (f.raw->>'VALOR_LIQUIDO_ITEM')::numeric valor,
                      CASE WHEN trim(f.raw->>'COD_UNIDADE_PRI')='KG' THEN COALESCE((f.raw->>'QTDE_PRI')::numeric,0) ELSE 0 END kg
               FROM public.ind_atak_fato f
               WHERE f.company_id=p_company_id AND f.dominio='comercial_devolucao' AND trim(f.raw->>'STATUS')<>'C'
                 AND left(f.raw->>'DATA_MOVTO',10) BETWEEN to_char(p_dt_ini,'YYYY-MM-DD') AND to_char(p_dt_fim,'YYYY-MM-DD')
                 AND f.raw->>'COD_TIPO_MV' = ANY (v_tipos_desc)
                 AND (v_vend IS NULL OR COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'),''),'s/v') = v_vend) ) s
        GROUP BY linha ) q;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'escopo', v_scope->>'modo', 'vendedor', v_vend,
    'volume_kg', r.volume_kg, 'faturamento', r.faturamento, 'clientes', r.clientes, 'cidades', r.cidades,
    'ticket_kg', ROUND(r.faturamento / NULLIF(r.volume_kg, 0), 4),
    'ticket_cliente', ROUND(r.faturamento / NULLIF(r.clientes, 0), 2),
    'faturamento_com_selecao', r.faturamento_com_selecao,
    'volume_kg_com_selecao', r.kg_com_selecao,
    'ticket_kg_com_selecao', ROUND(r.faturamento_com_selecao / NULLIF(r.kg_com_selecao, 0), 4),
    'faturamento_sem_despojo', r.faturamento_sem_despojo,
    'volume_kg_sem_despojo', r.volume_kg_sem_despojo,
    'ticket_kg_sem_despojo', ROUND(r.faturamento_sem_despojo / NULLIF(r.volume_kg_sem_despojo, 0), 4),
    'lucro', NULL, 'margem_pct', NULL, 'lucro_status', 'aguardando_dado_confiavel', 'fonte', 'venda_item_aceite',
    -- NOVOS (faturamento líquido + descarte). O card "Faturamento total" segue sendo o BRUTO (r.faturamento).
    'devolucoes_valor',    v_dev_valor,
    'devolucoes_kg',       v_dev_kg,
    'devolucoes_por_tipo', v_dev_tipos,
    'devolucoes_competencia_dia', v_dia_corte,   -- transparência: até o dia N conta no mês anterior.
    'tipos_devolucao',     COALESCE(to_jsonb(v_tipos_dev), '[]'::jsonb),
    'faturamento_liquido', round(COALESCE(r.faturamento, 0) - v_dev_valor, 2),
    'volume_kg_liquido',   round(COALESCE(r.volume_kg, 0) - v_dev_kg, 3),
    'descarte', jsonb_build_object(
       'status',       CASE WHEN v_desc_linhas > 0 THEN 'ok' ELSE 'aguardando_integracao' END,
       'tipos',        COALESCE(to_jsonb(v_tipos_desc), '[]'::jsonb),
       'total_valor',  v_desc_valor,
       'total_kg',     v_desc_kg,
       'por_produto',  v_desc_prod,
       'por_vendedor', v_desc_vend,
       'por_linha',    v_desc_linha));
END
$function$;

-- Guarda da função de leitura (fail-closed, inalterada em relação ao estado vivo): nunca anon/PUBLIC.
REVOKE ALL ON FUNCTION public.fn_bi_comercial_kpis(uuid, date, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_bi_comercial_kpis(uuid, date, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_kpis(uuid, date, date, text) TO authenticated, service_role;

-- "?" (RD-95): deixar explícito no card qual devolução é considerada. Idempotente (atualiza só o texto da chave já criada na #4850).
UPDATE public.erp_ajuda_campo
   SET para_que_serve = 'É o faturamento bruto menos as devoluções reais (tipos T582 e T583) do período, por COMPETÊNCIA. '
                     || 'Devolução considerada: a lançada dentro do mês mais a lançada nos primeiros dias do mês seguinte que se refere a este mês '
                     || '(regra de fechamento: devolução lançada até o dia 5 conta no mês anterior). Assim o número bate melhor com o relatório do ATAK — '
                     || 'o que de fato entrou, depois de tirar o que voltou. O card "Faturamento" ao lado continua mostrando o bruto (antes das devoluções).',
       erro_comum   = 'Estranhar a devolução de uma venda aparecer no mês da venda e não no mês em que foi lançada: é de propósito (competência), '
                     || 'para o fechamento do mês bater com o faturamento daquele mês.',
       versao       = COALESCE(versao, 1) + 1,
       atualizado_em = now()
 WHERE chave = 'com.painel.faturado_liquido' AND rota = '/dashboard/comercial/meu-painel';
