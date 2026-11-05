-- BI Comercial · Parte 0 (fundação, SPEC ajustada CEO 05/11). Aditiva: nada existente é alterado.
--
-- 1) bi_comercial_item_mv: view materializada do detalhe nota a nota (domínio comercial_venda_item do ATAK, em
--    ind_atak_fato.raw jsonb). Fonte real do BI (2,09M kg out–nov; o resumo comercial_vendas dá 838k).
--    Sem regra de descarte por R$/kg (CEO 05/11): todas as linhas entram; a exclusão é só por produto.
--    REVOKE total: a MV não tem RLS, então só é lida pelas funções com guarda de empresa abaixo.
-- 2) bi_comercial_produto_classificacao: classificação humana por produto ('entra' / 'fora' / 'a_classificar'),
--    persistente por empresa. Produto sem linha = 'a_classificar'. Escrita só por fn_bi_comercial_produto_classificar.
-- 3) fn_bi_comercial_produtos (lista com status e totais) e fn_bi_comercial_totais (dois totais: com a seleção e
--    faturamento total). Guarda: get_user_company_ids / is_admin.
-- 4) fn_bi_comercial_item_refresh: REFRESH CONCURRENTLY, só service_role (o agendamento do refresh é passo à parte).

CREATE MATERIALIZED VIEW IF NOT EXISTS public.bi_comercial_item_mv AS
SELECT f.company_id,
       f.chave_fato,
       ((f.raw->>'DATA_MOVTO')::timestamptz AT TIME ZONE 'UTC')::date AS data,
       f.raw->>'COD_PRODUTO'                                AS cod_produto,
       f.raw->>'DESC_PRODUTO_EST'                           AS desc_produto,
       NULLIF(f.raw->>'PESO_LIQUIDO', '')::numeric          AS kg,
       NULLIF(f.raw->>'QTDE_PRI', '')::numeric              AS qtde_pri,
       NULLIF(f.raw->>'VALOR_TOTAL_ITEM', '')::numeric      AS valor_total,
       NULLIF(f.raw->>'VALOR_LIQUIDO_ITEM', '')::numeric    AS valor_liquido,
       NULLIF(f.raw->>'VALOR_CUSTO', '')::numeric           AS valor_custo,
       NULLIF(f.raw->>'VALOR_FRETE_ITEM', '')::numeric      AS valor_frete,
       f.raw->>'COD_VEND_COMP'                              AS cod_vend,
       f.raw->>'COD_CLI_FOR'                                AS cod_cliente,
       f.raw->>'APELIDO'                                    AS cliente_apelido,
       f.raw->>'CIDADE'                                     AS cidade,
       f.raw->>'UF'                                         AS uf,
       f.raw->>'PLACA1'                                     AS placa1,
       f.raw->>'NUM_DOCTO'                                  AS num_docto,
       f.raw->>'STATUS_ITEM'                                AS status_item,
       f.imported_at
  FROM public.ind_atak_fato f
 WHERE f.dominio = 'comercial_venda_item';

CREATE UNIQUE INDEX IF NOT EXISTS ux_bi_comercial_item_mv ON public.bi_comercial_item_mv (company_id, chave_fato);
CREATE INDEX IF NOT EXISTS ix_bi_comercial_item_mv_data ON public.bi_comercial_item_mv (company_id, data);
CREATE INDEX IF NOT EXISTS ix_bi_comercial_item_mv_vend ON public.bi_comercial_item_mv (company_id, cod_vend);
CREATE INDEX IF NOT EXISTS ix_bi_comercial_item_mv_prod ON public.bi_comercial_item_mv (company_id, cod_produto);

REVOKE ALL ON public.bi_comercial_item_mv FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bi_comercial_item_mv TO service_role;

-- ── 2. Classificação de produtos (persistente por empresa) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bi_comercial_produto_classificacao (
  company_id   uuid NOT NULL,
  cod_produto  text NOT NULL,
  status       text NOT NULL DEFAULT 'a_classificar' CHECK (status IN ('entra', 'fora', 'a_classificar')),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid,
  PRIMARY KEY (company_id, cod_produto)
);
ALTER TABLE public.bi_comercial_produto_classificacao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bi_comercial_produto_classificacao FROM PUBLIC, anon, authenticated;

-- ── 3. Leitura com guarda de empresa ──────────────────────────────────────────────────────────────────
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
                 'cod_produto', m.cod_produto,
                 'desc_produto', max(m.desc_produto),
                 'status', COALESCE(c.status, 'a_classificar'),
                 'kg', round(sum(m.kg), 3),
                 'valor_total', round(sum(m.valor_total), 2)) AS p
          FROM public.bi_comercial_item_mv m
          LEFT JOIN public.bi_comercial_produto_classificacao c
                 ON c.company_id = m.company_id AND c.cod_produto = m.cod_produto
         WHERE m.company_id = p_company_id AND m.data BETWEEN p_de AND p_ate
         GROUP BY m.cod_produto, c.status
      ) s), '[]'::jsonb));
END
$fn$;

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
  -- (a) COM a seleção: só produtos marcados 'entra'. (b) FATURAMENTO TOTAL: tudo, sem filtro.
  -- 'fora' e 'a_classificar' ficam de fora de (a) e aparecem à parte, para o total nunca sumir.
  RETURN (
    SELECT jsonb_build_object(
      'ok', true,
      'faturamento_total', round(COALESCE(sum(m.valor_total), 0), 2),
      'kg_total', round(COALESCE(sum(m.kg), 0), 3),
      'com_selecao_valor', round(COALESCE(sum(m.valor_total) FILTER (WHERE c.status = 'entra'), 0), 2),
      'com_selecao_kg', round(COALESCE(sum(m.kg) FILTER (WHERE c.status = 'entra'), 0), 3),
      'fora_valor', round(COALESCE(sum(m.valor_total) FILTER (WHERE c.status = 'fora'), 0), 2),
      'a_classificar_valor', round(COALESCE(sum(m.valor_total) FILTER (WHERE COALESCE(c.status, 'a_classificar') = 'a_classificar'), 0), 2),
      'linhas', count(*))
      FROM public.bi_comercial_item_mv m
      LEFT JOIN public.bi_comercial_produto_classificacao c
             ON c.company_id = m.company_id AND c.cod_produto = m.cod_produto
     WHERE m.company_id = p_company_id AND m.data BETWEEN p_de AND p_ate);
END
$fn$;

-- ── 4. Escrita: classificar um produto (guarda de empresa; status validado) ───────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_produto_classificar(p_company_id uuid, p_cod_produto text, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF p_company_id IS NULL OR NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  IF p_status NOT IN ('entra', 'fora', 'a_classificar') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status_invalido');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bi_comercial_item_mv WHERE company_id = p_company_id AND cod_produto = p_cod_produto) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'produto_nao_encontrado');
  END IF;
  INSERT INTO public.bi_comercial_produto_classificacao (company_id, cod_produto, status, atualizado_em, atualizado_por)
  VALUES (p_company_id, p_cod_produto, p_status, now(), auth.uid())
  ON CONFLICT (company_id, cod_produto)
  DO UPDATE SET status = EXCLUDED.status, atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por;
  RETURN jsonb_build_object('ok', true, 'cod_produto', p_cod_produto, 'status', p_status);
END
$fn$;

-- ── 5. Refresh (cron à parte): só service_role ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_item_refresh()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.bi_comercial_item_mv;
  RETURN jsonb_build_object('ok', true, 'em', now());
END
$fn$;

REVOKE ALL ON FUNCTION public.fn_bi_comercial_produtos(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bi_comercial_totais(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bi_comercial_produto_classificar(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bi_comercial_item_refresh() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_produtos(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_totais(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_produto_classificar(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_item_refresh() TO service_role;
