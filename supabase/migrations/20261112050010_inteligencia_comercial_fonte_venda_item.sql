-- Inteligência comercial · fonte CORRETA nas RPCs da tela (CEO 10/11, correção aprovada).
--
-- As RPCs fn_bi_comercial_totais, _serie e _analise liam bi_comercial_item_mv, que não tira itens cancelados
-- (STATUS_ITEM C) nem o produto 10: R$ 14.237.074 contra o aceite R$ 13.983.740. Passam a ler
-- bi_comercial_venda_item_mv (a MV de fn_com_venda_item, com os mesmos filtros). Mesma assinatura, mesmas chaves,
-- mesma guarda. fn_bi_comercial_status não muda: lê só a data do último refresh, não valor de venda.
--
-- Mudanças de conteúdo (documentadas):
--   · valor = valor líquido do item (fecha o aceite); kg = QTDE_PRI em KG (medida do aceite).
--   · rótulo de cidade: cidade sem a UF (a MV guarda 'Cidade/UF'); a UF vem do sufixo.
--   · rótulo de cliente segue o apelido (lido de ind_atak_fato, como antes); produto usa a descrição da NF.

-- 1) Totais (mesma assinatura)
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_totais(p_company_id uuid, p_de date, p_ate date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF p_company_id IS NULL OR NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'ok', true,
      'faturamento_total', round(COALESCE(sum(m.valor), 0), 2),
      'kg_total', round(COALESCE(sum(m.kg), 0), 3),
      'com_selecao_valor', round(COALESCE(sum(m.valor) FILTER (WHERE c.status = 'entra'), 0), 2),
      'com_selecao_kg', round(COALESCE(sum(m.kg) FILTER (WHERE c.status = 'entra'), 0), 3),
      'fora_valor', round(COALESCE(sum(m.valor) FILTER (WHERE c.status = 'fora'), 0), 2),
      'a_classificar_valor', round(COALESCE(sum(m.valor) FILTER (WHERE COALESCE(c.status, 'a_classificar') = 'a_classificar'), 0), 2),
      'linhas', count(*))
      FROM public.bi_comercial_venda_item_mv m
      LEFT JOIN public.bi_comercial_produto_classificacao c
             ON c.company_id = m.company_id AND c.cod_produto = m.produto_cod
     WHERE m.company_id = p_company_id AND m.dia BETWEEN p_de AND p_ate);
END
$fn$;

-- 2) Série temporal (mesma assinatura)
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_serie(p_company_id uuid, p_dt_ini date, p_dt_fim date, p_granularidade text DEFAULT 'mes'::text, p_vendedor text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_scope jsonb; v_vend text; v_trunc text; v_out jsonb;
BEGIN
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' = 'sem_acesso' THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial'); END IF;
  v_vend := CASE WHEN v_scope->>'modo' = 'vendedor' THEN v_scope->>'cod' ELSE p_vendedor END;
  v_trunc := CASE lower(COALESCE(p_granularidade, 'mes'))
               WHEN 'dia' THEN 'day' WHEN 'semana' THEN 'week' WHEN 'mes' THEN 'month'
               WHEN 'trimestre' THEN 'quarter' WHEN 'ano' THEN 'year' ELSE 'month' END;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'periodo', per, 'volume_kg', vol, 'faturamento', fat, 'margem_pct', NULL) ORDER BY per), '[]'::jsonb)
    INTO v_out
  FROM (
    SELECT date_trunc(v_trunc, m.dia::timestamp)::date AS per, SUM(m.kg) AS vol, SUM(m.valor) AS fat
      FROM public.bi_comercial_venda_item_mv m
     WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini AND p_dt_fim
       AND (v_vend IS NULL OR m.vendedor = v_vend)
     GROUP BY 1
  ) s;
  RETURN jsonb_build_object('ok', true, 'granularidade', v_trunc, 'serie', v_out,
    'lucro_status', 'aguardando_dado_confiavel');
END
$fn$;

-- 3) Análise por dimensão (mesma assinatura). O preço de tabela (flex) continua vindo do raw, como antes.
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_analise(
  p_company_id uuid,
  p_dt_ini date,
  p_dt_fim date,
  p_dimensao text DEFAULT 'cliente',
  p_vendedor text DEFAULT NULL,
  p_cidade text DEFAULT NULL,
  p_cod_cliente text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_scope jsonb; v_vend text; v_dim text; v_itens jsonb; v_tot jsonb;
BEGIN
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' = 'sem_acesso' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial');
  END IF;
  v_vend := CASE WHEN v_scope->>'modo' = 'vendedor' THEN v_scope->>'cod' ELSE p_vendedor END;
  v_dim := lower(COALESCE(p_dimensao, 'cliente'));

  WITH base AS (
    SELECT
      CASE v_dim
        WHEN 'vendedor' THEN m.vendedor
        WHEN 'cidade'   THEN COALESCE(NULLIF(upper(btrim(split_part(m.cidade, '/', 1))), ''), '(sem cidade)')
        WHEN 'produto'  THEN COALESCE(NULLIF(btrim(m.produto), ''), m.produto_cod)
        ELSE COALESCE(NULLIF(btrim(f.raw->>'APELIDO'), ''), m.cliente_cod)
      END AS rotulo,
      CASE v_dim
        WHEN 'vendedor' THEN m.vendedor
        WHEN 'cidade'   THEN COALESCE(NULLIF(upper(btrim(split_part(m.cidade, '/', 1))), ''), '(sem cidade)')
        WHEN 'produto'  THEN m.produto_cod
        ELSE m.cliente_cod
      END AS chave,
      m.cliente_cod, m.produto_cod, m.kg, m.valor AS valor_total, m.dia AS data,
      split_part(m.cidade, '/', 2) AS uf,
      CASE WHEN NULLIF(f.raw->>'VALOR_UNITARIO_LISTA','')::numeric > 0
           THEN NULLIF(f.raw->>'VALOR_UNITARIO','')::numeric * NULLIF(f.raw->>'QTDE_UND','')::numeric END AS prat,
      CASE WHEN NULLIF(f.raw->>'VALOR_UNITARIO_LISTA','')::numeric > 0
           THEN NULLIF(f.raw->>'VALOR_UNITARIO_LISTA','')::numeric * NULLIF(f.raw->>'QTDE_UND','')::numeric END AS lista
    FROM public.bi_comercial_venda_item_mv m
    LEFT JOIN public.ind_atak_fato f
      ON f.company_id = m.company_id AND f.dominio = 'comercial_venda_item' AND f.chave_fato = m.fato_id
    WHERE m.company_id = p_company_id
      AND m.dia BETWEEN p_dt_ini AND p_dt_fim
      AND (v_vend IS NULL OR m.vendedor = v_vend)
      AND (p_cidade IS NULL OR COALESCE(NULLIF(upper(btrim(split_part(m.cidade, '/', 1))), ''), '(sem cidade)') = upper(btrim(p_cidade)))
      AND (p_cod_cliente IS NULL OR m.cliente_cod = p_cod_cliente)
  ), agg AS (
    SELECT rotulo, chave,
           SUM(kg) AS kg, SUM(valor_total) AS fat,
           COUNT(DISTINCT cliente_cod) AS n_clientes,
           COUNT(DISTINCT produto_cod) AS n_produtos,
           MAX(data) AS ultima, MAX(uf) AS uf,
           SUM(prat) AS prat, SUM(lista) AS lista
      FROM base GROUP BY rotulo, chave
  )
  -- Um único statement lê o CTE duas vezes (itens e total). Dois statements separados não enxergam o CTE.
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'rotulo', a.rotulo, 'chave', a.chave,
      'kg', ROUND(a.kg, 0), 'faturamento', ROUND(a.fat, 2),
      'rpkg', ROUND(a.fat / NULLIF(a.kg, 0), 2),
      'n_clientes', a.n_clientes, 'n_produtos', a.n_produtos,
      'uf', a.uf, 'ultima_compra', a.ultima,
      'flex_pct', CASE WHEN a.lista > 0 THEN ROUND((1 - a.prat / a.lista) * 100, 2) ELSE NULL END,
      'cargo', CASE WHEN v_dim = 'vendedor' THEN
        (SELECT h.raw->>'Cargo' FROM public.ind_atak_fato h
          WHERE h.company_id = p_company_id AND h.dominio = 'comercial_hierarquia'
            AND h.raw->>'Cod_cadastro' = a.chave LIMIT 1) END,
      'filial', CASE WHEN v_dim = 'vendedor' THEN
        (SELECT h.raw->>'Cod_filial' FROM public.ind_atak_fato h
          WHERE h.company_id = p_company_id AND h.dominio = 'comercial_hierarquia'
            AND h.raw->>'Cod_cadastro' = a.chave LIMIT 1) END
    ) ORDER BY a.fat DESC NULLS LAST) FROM agg a), '[]'::jsonb),
    (SELECT jsonb_build_object('n', COUNT(*), 'kg', ROUND(SUM(a.kg), 0), 'faturamento', ROUND(SUM(a.fat), 2),
      'rpkg', ROUND(SUM(a.fat) / NULLIF(SUM(a.kg), 0), 2),
      'flex_pct', CASE WHEN SUM(a.lista) > 0 THEN ROUND((1 - SUM(a.prat) / SUM(a.lista)) * 100, 2) ELSE NULL END)
     FROM agg a)
  INTO v_itens, v_tot;

  RETURN jsonb_build_object('ok', true, 'dimensao', v_dim, 'escopo', v_scope->>'modo',
                            'itens', v_itens, 'total', COALESCE(v_tot, '{}'::jsonb));
END
$function$;

REVOKE ALL ON FUNCTION public.fn_bi_comercial_totais(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bi_comercial_serie(uuid, date, date, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bi_comercial_analise(uuid, date, date, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_totais(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_serie(uuid, date, date, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_analise(uuid, date, date, text, text, text, text) TO authenticated, service_role;
