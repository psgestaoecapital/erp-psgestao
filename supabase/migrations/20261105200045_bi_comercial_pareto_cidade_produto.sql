-- BI Comercial · Pareto: novas dimensões CIDADE e PRODUTO (dado já vivo na view #3943 bi_comercial_item_mv)
-- Aditivo: só acrescenta dois ramos ao CASE da dimensão; mesma assinatura, mesmo guarda de escopo (fn_bi_comercial_scope),
-- mesma segurança (SECURITY DEFINER, search_path travado) e os mesmos grants (REVOKE anon; EXECUTE p/ authenticated/service_role).
-- CIDADE normalizada por upper(btrim(...)) — funde duplicatas por caixa (ex.: "Nova Erechim" × "NOVA ERECHIM").
-- PRODUTO rotulado pela descrição (fallback no código).
-- Prova RD-38 (company 975365cc-…-68c6bfde10d8, ind_atak): cidade → 86 grupos (de 88 cruas), produto → 128 grupos;
-- ambos somam R$ 13.529.249 (= faturamento total, nenhuma linha perdida).
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_pareto(p_company_id uuid, p_dt_ini date, p_dt_fim date, p_dimensao text DEFAULT 'cliente'::text, p_vendedor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                   WHEN 'cidade' THEN NULLIF(upper(btrim(m.cidade)), '')
                   WHEN 'produto' THEN COALESCE(NULLIF(btrim(m.desc_produto), ''), m.cod_produto)
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
$function$;

REVOKE ALL ON FUNCTION public.fn_bi_comercial_pareto(uuid, date, date, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_pareto(uuid, date, date, text, text) TO authenticated, service_role;
