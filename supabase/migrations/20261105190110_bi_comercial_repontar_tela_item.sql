-- BI Comercial · PR1 da SPEC (CEO 05/11): repontar as RPCs da tela para o detalhe por item (bi_comercial_item_mv),
-- mantendo assinatura, RBAC (fn_bi_comercial_scope) e forma do JSON que a tela lê. Aditiva em tudo que é novo;
-- as quatro RPCs são substituídas por CREATE OR REPLACE (mesma assinatura).
--
-- Decisões (SPEC/CEO 05/11):
--  · Sem regra de descarte por R$/kg. Vendedor 80005 fica no BI.
--  · LUCRO: o detalhe por item não traz LUCRO confiável; lucro/margem voltam null com lucro_status
--    'aguardando_dado_confiavel' (a margem real com VALOR_CUSTO vem na aba de margem, próxima SPEC).
--  · Cidade agrupada sem diferença de caixa/acento (ex.: "NOVA ERECHIM" = "Nova Erechim").
--  · Dimensões do pareto: cliente, vendedor, supervisor, filial (filial e supervisor lidos do raw do item / hierarquia).
--  · KPIs ganham os totais "com seleção" (produtos 'entra') e o ticket com seleção; os campos antigos ficam.
--  · Refresh a cada 30 min (pg_cron) e status "atualizado às HH:MM" por empresa.

-- ── 1. Status do refresh por empresa ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bi_comercial_item_status (
  company_id    uuid PRIMARY KEY,
  atualizado_em timestamptz NOT NULL
);
ALTER TABLE public.bi_comercial_item_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bi_comercial_item_status FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_bi_comercial_item_refresh()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.bi_comercial_item_mv;
  INSERT INTO public.bi_comercial_item_status (company_id, atualizado_em)
  SELECT DISTINCT company_id, now() FROM public.bi_comercial_item_mv
  ON CONFLICT (company_id) DO UPDATE SET atualizado_em = EXCLUDED.atualizado_em;
  RETURN jsonb_build_object('ok', true, 'em', now());
END
$fn$;
REVOKE ALL ON FUNCTION public.fn_bi_comercial_item_refresh() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_item_refresh() TO service_role;

CREATE OR REPLACE FUNCTION public.fn_bi_comercial_status(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_scope jsonb;
BEGIN
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' = 'sem_acesso' THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial'); END IF;
  RETURN jsonb_build_object('ok', true, 'atualizado_em', (SELECT atualizado_em FROM public.bi_comercial_item_status WHERE company_id = p_company_id));
END
$fn$;
REVOKE ALL ON FUNCTION public.fn_bi_comercial_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_status(uuid) TO authenticated, service_role;

-- ── 2. KPIs (mesma assinatura) ─────────────────────────────────────────────────────────────────────────
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
         COALESCE(SUM(m.valor_total), 0) AS faturamento,
         COUNT(DISTINCT m.cod_cliente) AS clientes,
         COUNT(DISTINCT upper(translate(m.cidade, 'ÁÀÂÃÉÈÊÍÌÓÒÔÕÚÙÇáàâãéèêíìóòôõúùç', 'AAAAEEEIIOOOUUCaaaaeeeiiooouuc'))) AS cidades,
         COALESCE(SUM(m.kg) FILTER (WHERE c.status = 'entra'), 0) AS kg_com_selecao,
         COALESCE(SUM(m.valor_total) FILTER (WHERE c.status = 'entra'), 0) AS faturamento_com_selecao
    INTO r
    FROM public.bi_comercial_item_mv m
    LEFT JOIN public.bi_comercial_produto_classificacao c ON c.company_id = m.company_id AND c.cod_produto = m.cod_produto
   WHERE m.company_id = p_company_id AND m.data BETWEEN p_dt_ini AND p_dt_fim
     AND (v_vend IS NULL OR m.cod_vend = v_vend);
  RETURN jsonb_build_object('ok', true, 'escopo', v_scope->>'modo', 'vendedor', v_vend,
    'volume_kg', r.volume_kg, 'faturamento', r.faturamento, 'clientes', r.clientes, 'cidades', r.cidades,
    'ticket_kg', ROUND(r.faturamento / NULLIF(r.volume_kg, 0), 4),
    'ticket_cliente', ROUND(r.faturamento / NULLIF(r.clientes, 0), 2),
    'faturamento_com_selecao', r.faturamento_com_selecao,
    'volume_kg_com_selecao', r.kg_com_selecao,
    'ticket_kg_com_selecao', ROUND(r.faturamento_com_selecao / NULLIF(r.kg_com_selecao, 0), 4),
    'lucro', NULL, 'margem_pct', NULL, 'lucro_status', 'aguardando_dado_confiavel', 'fonte', 'detalhe_item');
END
$fn$;

-- ── 3. Série temporal (mesma assinatura) ────────────────────────────────────────────────────────────────
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
    SELECT date_trunc(v_trunc, m.data::timestamp)::date AS per, SUM(m.kg) AS vol, SUM(m.valor_total) AS fat
      FROM public.bi_comercial_item_mv m
     WHERE m.company_id = p_company_id AND m.data BETWEEN p_dt_ini AND p_dt_fim
       AND (v_vend IS NULL OR m.cod_vend = v_vend)
     GROUP BY 1
  ) s;
  RETURN jsonb_build_object('ok', true, 'granularidade', v_trunc, 'serie', v_out,
    'lucro_status', 'aguardando_dado_confiavel');
END
$fn$;

-- ── 4. Pareto por dimensão (mesma assinatura) ───────────────────────────────────────────────────────────
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
                   WHEN 'vendedor' THEN m.cod_vend
                   WHEN 'filial' THEN f.raw->>'COD_FILIAL'
                   WHEN 'supervisor' THEN (SELECT h.raw->>'Subordinado_a_Nome' FROM public.ind_atak_fato h
                                            WHERE h.company_id = m.company_id AND h.dominio = 'comercial_hierarquia'
                                              AND h.raw->>'Cod_cadastro' = m.cod_vend LIMIT 1)
                   ELSE m.cliente_apelido
                 END AS rot,
                 m.valor_total AS valor
            FROM public.bi_comercial_item_mv m
            LEFT JOIN public.ind_atak_fato f ON f.company_id = m.company_id AND f.dominio = 'comercial_venda_item' AND f.chave_fato = m.chave_fato
           WHERE m.company_id = p_company_id AND m.data BETWEEN p_dt_ini AND p_dt_fim
             AND (v_vend IS NULL OR m.cod_vend = v_vend)
        ) g
       GROUP BY 1
    ) agg
  ) p;
  RETURN jsonb_build_object('ok', true, 'dimensao', v_dim, 'itens', v_out);
END
$fn$;

-- ── 5. Ranking de vendedores (líder; mesma assinatura) ─────────────────────────────────────────────────
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
    SELECT m.cod_vend AS cod,
           (SELECT h.raw->>'Apelido' FROM public.ind_atak_fato h
             WHERE h.company_id = p_company_id AND h.dominio = 'comercial_hierarquia' AND h.raw->>'Cod_cadastro' = m.cod_vend LIMIT 1) AS nome,
           SUM(m.kg) AS vol, SUM(m.valor_total) AS fat, COUNT(DISTINCT m.cod_cliente) AS cli
      FROM public.bi_comercial_item_mv m
     WHERE m.company_id = p_company_id AND m.data BETWEEN p_dt_ini AND p_dt_fim
     GROUP BY m.cod_vend
  ) r;
  RETURN jsonb_build_object('ok', true, 'ranking', v_out, 'lucro_status', 'aguardando_dado_confiavel');
END
$fn$;

REVOKE ALL ON FUNCTION public.fn_bi_comercial_kpis(uuid, date, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bi_comercial_serie(uuid, date, date, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bi_comercial_pareto(uuid, date, date, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bi_comercial_ranking_vendedores(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_kpis(uuid, date, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_serie(uuid, date, date, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_pareto(uuid, date, date, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_ranking_vendedores(uuid, date, date) TO authenticated, service_role;

-- ── 6. Agendamento do refresh a cada 30 min (pg_cron) ───────────────────────────────────────────────────
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bi_comercial_item_refresh') THEN
    PERFORM cron.schedule('bi_comercial_item_refresh', '*/30 * * * *', 'SELECT public.fn_bi_comercial_item_refresh()');
  END IF;
END
$cron$;
