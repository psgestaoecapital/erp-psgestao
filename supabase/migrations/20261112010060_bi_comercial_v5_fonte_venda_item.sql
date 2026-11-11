-- BI Comercial · v5 com a fonte CORRETA (CEO 10/11, decisão confirmada).
--
-- PROBLEMA: as RPCs que a tela meu-painel (v5) chama — fn_bi_comercial_kpis, _pareto, _produtos e
-- _ranking_vendedores — liam bi_comercial_item_mv. Essa MV não tira itens cancelados (STATUS_ITEM = 'C') nem o
-- produto 10. Resultado: R$ 14.237.074 contra o aceite R$ 13.983.740 (diferença de R$ 253.334,14 = R$ 50.334,14
-- de cancelados + R$ 203.000,00 do produto 10, conferido ao centavo).
--
-- CORREÇÃO: estas 4 RPCs passam a ler bi_comercial_venda_item_mv — a MV que alimenta fn_com_venda_item, com os
-- mesmos filtros (STATUS <> 'C', COD_PRODUTO <> '10') e a data do próprio documento (DATA_MOVTO). Faturamento = VALOR
-- LÍQUIDO do item (fecha o aceite: R$ 13.983.740,09 · 482 clientes · 127 produtos, Frioeste 01/10–06/11).
--
-- MUDANÇAS DE CONTEÚDO (documentadas, a PR as mostra):
--   · volume_kg / kg passa a ser a quantidade em KG (QTDE_PRI, unidade KG) — a medida do aceite (751.065 kg no
--     período). Antes era PESO_LIQUIDO (2.228.134 kg). A definição de R$/kg sem despojo é outra decisão (CEO),
--     tratada à parte; aqui só se fixa a fonte.
--   · cidades conta a cidade sem a UF (split_part), para não mudar a contagem por causa do sufixo "/UF".
--   · as chaves JSON e as assinaturas NÃO mudam; a tela não precisa de alteração.
--
-- NÃO MEXE em: fn_bi_comercial_base (já usa fn_com_venda_item), fn_bi_comercial_scope, fn_bi_comercial_serie,
-- fn_bi_comercial_totais, fn_bi_comercial_analise, fn_bi_comercial_status (outras telas — seguem como estão e
-- entram em PRs próprias). A MV bi_comercial_item_mv continua existindo e sendo atualizada (não é apagada).
--
-- SEGURANÇA: as 4 funções já são SECURITY DEFINER com search_path fixo; mantêm a MESMA guarda (fn_bi_comercial_scope
-- ou get_user_company_ids/is_admin). REVOKE de PUBLIC/anon e GRANT só a authenticated e service_role. Nada de tabela
-- nova, nada de RLS, nada de dado de cliente alterado.

-- 1) KPIs (mesma assinatura)
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_kpis(p_company_id uuid, p_dt_ini date, p_dt_fim date, p_vendedor text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_scope jsonb; v_vend text; r RECORD;
BEGIN
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' = 'sem_acesso' THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial'); END IF;
  v_vend := CASE WHEN v_scope->>'modo' = 'vendedor' THEN v_scope->>'cod' ELSE p_vendedor END;
  SELECT COALESCE(SUM(m.kg), 0) AS volume_kg,
         COALESCE(SUM(m.valor), 0) AS faturamento,
         COUNT(DISTINCT m.cliente_cod) AS clientes,
         COUNT(DISTINCT upper(translate(split_part(m.cidade, '/', 1), 'ÁÀÂÃÉÈÊÍÌÓÒÔÕÚÙÇáàâãéèêíìóòôõúùç', 'AAAAEEEIIOOOUUCaaaaeeeiiooouuc'))) AS cidades,
         COALESCE(SUM(m.kg) FILTER (WHERE c.status = 'entra'), 0) AS kg_com_selecao,
         COALESCE(SUM(m.valor) FILTER (WHERE c.status = 'entra'), 0) AS faturamento_com_selecao
    INTO r
    FROM public.bi_comercial_venda_item_mv m
    LEFT JOIN public.bi_comercial_produto_classificacao c ON c.company_id = m.company_id AND c.cod_produto = m.produto_cod
   WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini AND p_dt_fim
     AND (v_vend IS NULL OR m.vendedor = v_vend);
  RETURN jsonb_build_object('ok', true, 'escopo', v_scope->>'modo', 'vendedor', v_vend,
    'volume_kg', r.volume_kg, 'faturamento', r.faturamento, 'clientes', r.clientes, 'cidades', r.cidades,
    'ticket_kg', ROUND(r.faturamento / NULLIF(r.volume_kg, 0), 4),
    'ticket_cliente', ROUND(r.faturamento / NULLIF(r.clientes, 0), 2),
    'faturamento_com_selecao', r.faturamento_com_selecao,
    'volume_kg_com_selecao', r.kg_com_selecao,
    'ticket_kg_com_selecao', ROUND(r.faturamento_com_selecao / NULLIF(r.kg_com_selecao, 0), 4),
    'lucro', NULL, 'margem_pct', NULL, 'lucro_status', 'aguardando_dado_confiavel', 'fonte', 'venda_item_aceite');
END
$fn$;

-- 2) Pareto por dimensão (mesma assinatura)
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_pareto(p_company_id uuid, p_dt_ini date, p_dt_fim date, p_dimensao text DEFAULT 'cliente'::text, p_vendedor text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_scope jsonb; v_vend text; v_dim text; v_out jsonb;
BEGIN
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' = 'sem_acesso' THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial'); END IF;
  v_vend := CASE WHEN v_scope->>'modo' = 'vendedor' THEN v_scope->>'cod' ELSE p_vendedor END;
  v_dim := lower(COALESCE(p_dimensao, 'cliente'));
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'rotulo', rotulo, 'valor', valor, 'pct', pct, 'pct_acumulado', pct_acum) ORDER BY valor DESC), '[]'::jsonb)
    INTO v_out
  FROM (
    SELECT rotulo, valor,
           ROUND(valor / NULLIF(SUM(valor) OVER (), 0) * 100, 2) AS pct,
           ROUND(SUM(valor) OVER (ORDER BY valor DESC ROWS UNBOUNDED PRECEDING) / NULLIF(SUM(valor) OVER (), 0) * 100, 2) AS pct_acum
    FROM (
      SELECT COALESCE(NULLIF(btrim(g.rot), ''), '(sem)') AS rotulo, SUM(g.valor) AS valor
        FROM (
          SELECT CASE v_dim
                   WHEN 'vendedor' THEN m.vendedor
                   WHEN 'filial' THEN f.raw->>'COD_FILIAL'
                   WHEN 'supervisor' THEN (SELECT h.raw->>'Subordinado_a_Nome' FROM public.ind_atak_fato h
                                            WHERE h.company_id = m.company_id AND h.dominio = 'comercial_hierarquia'
                                              AND h.raw->>'Cod_cadastro' = m.vendedor LIMIT 1)
                   ELSE f.raw->>'APELIDO'
                 END AS rot,
                 m.valor AS valor
            FROM public.bi_comercial_venda_item_mv m
            LEFT JOIN public.ind_atak_fato f ON f.company_id = m.company_id AND f.dominio = 'comercial_venda_item' AND f.chave_fato = m.fato_id
           WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini AND p_dt_fim
             AND (v_vend IS NULL OR m.vendedor = v_vend)
        ) g
       GROUP BY 1
    ) agg
  ) p;
  RETURN jsonb_build_object('ok', true, 'dimensao', v_dim, 'itens', v_out);
END
$fn$;

-- 3) Ranking de vendedores (líder; mesma assinatura)
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_ranking_vendedores(p_company_id uuid, p_dt_ini date, p_dt_fim date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_scope jsonb; v_out jsonb;
BEGIN
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' <> 'lider' THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'cod_vend_comp', r.cod, 'vendedor', COALESCE(r.nome, r.cod), 'volume_kg', r.vol, 'faturamento', r.fat,
      'clientes', r.cli, 'lucro', NULL, 'margem_pct', NULL) ORDER BY r.fat DESC), '[]'::jsonb)
    INTO v_out
  FROM (
    SELECT m.vendedor AS cod,
           (SELECT h.raw->>'Apelido' FROM public.ind_atak_fato h
             WHERE h.company_id = p_company_id AND h.dominio = 'comercial_hierarquia' AND h.raw->>'Cod_cadastro' = m.vendedor LIMIT 1) AS nome,
           SUM(m.kg) AS vol, SUM(m.valor) AS fat, COUNT(DISTINCT m.cliente_cod) AS cli
      FROM public.bi_comercial_venda_item_mv m
     WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini AND p_dt_fim
     GROUP BY m.vendedor
  ) r;
  RETURN jsonb_build_object('ok', true, 'ranking', v_out, 'lucro_status', 'aguardando_dado_confiavel');
END
$fn$;

-- 4) Produtos (mesma assinatura; guarda por empresa, como antes)
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_produtos(p_company_id uuid, p_de date, p_ate date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF p_company_id IS NULL OR NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  RETURN jsonb_build_object('ok', true, 'produtos', COALESCE((
    SELECT jsonb_agg(p ORDER BY (p->>'valor_total')::numeric DESC NULLS LAST)
      FROM (
        SELECT jsonb_build_object(
                 'cod_produto', m.produto_cod,
                 'desc_produto', max(m.produto),
                 'status', COALESCE(c.status, 'a_classificar'),
                 'kg', round(sum(m.kg), 3),
                 'valor_total', round(sum(m.valor), 2)) AS p
          FROM public.bi_comercial_venda_item_mv m
          LEFT JOIN public.bi_comercial_produto_classificacao c
                 ON c.company_id = m.company_id AND c.cod_produto = m.produto_cod
         WHERE m.company_id = p_company_id AND m.dia BETWEEN p_de AND p_ate
         GROUP BY m.produto_cod, c.status
      ) s), '[]'::jsonb));
END
$fn$;

REVOKE ALL ON FUNCTION public.fn_bi_comercial_kpis(uuid, date, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bi_comercial_pareto(uuid, date, date, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bi_comercial_ranking_vendedores(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bi_comercial_produtos(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_kpis(uuid, date, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_pareto(uuid, date, date, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_ranking_vendedores(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_produtos(uuid, date, date) TO authenticated, service_role;
