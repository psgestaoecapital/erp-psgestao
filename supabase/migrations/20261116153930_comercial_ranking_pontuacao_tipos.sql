-- Ranking de vendedores (pontuação): faturamento SÓ dos tipos de venda (CEO 13/11, contexto 61723f79).
--
-- fn_bi_comercial_ranking_pontuacao lê bi_comercial_venda_item_mv direto e já filtra `carne`, mas contava TODOS
-- os tipos de movimento de carne — incluindo BALCÃO (5200/5201) e PERDA (5235). Prova no dado (Frioeste
-- 975365cc, 2026-01-01..2026-11-13): faturamento de carne com tudo = R$ 112.411.418 × só 'venda_faturamento'
-- (T520, 520) = R$ 109.086.774 → contaminação de R$ 3.324.644 (2,96%). Top vendedor (Valcir, 80002): R$ 29.762.708.
--
-- Correção: as leituras da MV passam a usar SÓ os tipos 'venda_faturamento' (config por empresa — mesma da #4938,
-- semeada só p/ Frioeste; empresa sem config = comportamento atual, nenhum outro cliente muda). O tipo de movimento
-- vem de um join leve na ind_atak_fato pela chave única do item (f.chave_fato = m.fato_id), mesmo padrão do _pareto.
-- Centralizo os itens filtrados em dois CTEs (vi_atual / vi_ant) e aponto preco_prod/atual/ant/novos para eles — a
-- lógica de pontuação (normalização, blocos, pódio) fica IDÊNTICA, só muda a FONTE dos itens.
--
-- Aditiva: só CREATE OR REPLACE da função. Assinatura/saída inalteradas. SECURITY DEFINER + search_path + guarda de
-- escopo (fn_bi_comercial_scope, só líder) + REVOKE anon mantidos. Sem front, sem tocar dado.

CREATE OR REPLACE FUNCTION public.fn_bi_comercial_ranking_pontuacao(p_company_id uuid, p_dt_ini date, p_dt_fim date, p_dt_ini_ant date, p_dt_fim_ant date, p_peso_crescimento numeric DEFAULT 0.5, p_peso_margem numeric DEFAULT 0.5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope jsonb; v_out jsonb; v_pc numeric; v_pm numeric; v_tipos_dev text[]; v_tf text[];
BEGIN
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' <> 'lider' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial');
  END IF;

  v_pc := COALESCE(NULLIF(p_peso_crescimento, 0), 0.5);
  v_pm := COALESCE(NULLIF(p_peso_margem, 0), 0.5);
  IF (v_pc + v_pm) <= 0 THEN v_pc := 0.5; v_pm := 0.5; END IF;
  SELECT v_pc / (v_pc + v_pm), v_pm / (v_pc + v_pm) INTO v_pc, v_pm;

  BEGIN
    SELECT array_agg(cod_tipo_mv) INTO v_tipos_dev
      FROM public.fn_comercial_tipos_efetivos(p_company_id, 'devolucao_abate');
  EXCEPTION WHEN undefined_function OR undefined_table THEN
    v_tipos_dev := ARRAY['T582', 'T583'];
  END;
  IF v_tipos_dev IS NULL OR cardinality(v_tipos_dev) = 0 THEN
    v_tipos_dev := ARRAY['T582', 'T583'];
  END IF;

  -- Tipos que compõem o faturamento (ex.: Frioeste T520, 520). Vazio => sem filtro (comportamento atual).
  BEGIN
    SELECT array_agg(cod_tipo_mv) INTO v_tf
      FROM public.fn_comercial_tipos_efetivos(p_company_id, 'venda_faturamento');
  EXCEPTION WHEN undefined_function OR undefined_table THEN
    v_tf := NULL;
  END;

  WITH
  -- Itens de venda de carne SÓ dos tipos de faturamento (ou todos, se a empresa não configurou). Fonte única.
  vi_atual AS (
    SELECT m.vendedor, m.cliente_cod, m.cidade, m.produto_cod, m.kg, m.valor, m.valor_tabela
    FROM public.bi_comercial_venda_item_mv m
    LEFT JOIN public.ind_atak_fato ft
           ON ft.company_id = m.company_id AND ft.dominio = 'comercial_venda_item' AND ft.chave_fato = m.fato_id
    WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini AND p_dt_fim AND m.carne
      AND (v_tf IS NULL OR trim(ft.raw->>'COD_TIPO_MV') = ANY (v_tf))
  ),
  vi_ant AS (
    SELECT m.vendedor, m.cliente_cod, m.cidade, m.kg, m.valor
    FROM public.bi_comercial_venda_item_mv m
    LEFT JOIN public.ind_atak_fato ft
           ON ft.company_id = m.company_id AND ft.dominio = 'comercial_venda_item' AND ft.chave_fato = m.fato_id
    WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini_ant AND p_dt_fim_ant AND m.carne
      AND (v_tf IS NULL OR trim(ft.raw->>'COD_TIPO_MV') = ANY (v_tf))
  ),
  preco_prod AS (
    SELECT produto_cod, sum(valor) / NULLIF(sum(kg), 0) p
    FROM vi_atual WHERE kg > 0
    GROUP BY produto_cod
  ),
  atual AS (
    SELECT v.vendedor cod, sum(v.valor) fat, sum(v.kg) vol,
           count(DISTINCT v.cliente_cod) cli,
           count(DISTINCT upper(translate(split_part(v.cidade, '/', 1), 'ÁÀÂÃÉÈÊÍÌÓÒÔÕÚÙÇáàâãéèêíìóòôõúùç', 'AAAAEEEIIOOOUUCaaaaeeeiiooouuc'))) cid,
           sum(v.valor_tabela) vtab, sum(COALESCE(v.kg, 0) * COALESCE(pp.p, 0)) exp_val
    FROM vi_atual v
    LEFT JOIN preco_prod pp ON pp.produto_cod = v.produto_cod
    WHERE v.vendedor <> 's/v'
      AND NOT EXISTS (
        SELECT 1 FROM public.com_ranking_participante rp
         WHERE rp.company_id = p_company_id AND rp.cod_vendedor = v.vendedor AND rp.incluido = false)
    GROUP BY v.vendedor
  ),
  ant AS (
    SELECT vendedor cod, sum(valor) fat_ant, sum(kg) vol_ant
    FROM vi_ant WHERE vendedor <> 's/v'
    GROUP BY vendedor
  ),
  novos AS (
    SELECT a.vendedor cod,
      count(DISTINCT a.cliente_cod) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM vi_ant b WHERE b.vendedor = a.vendedor AND b.cliente_cod = a.cliente_cod)) cli_novos,
      count(DISTINCT upper(translate(split_part(a.cidade, '/', 1), 'ÁÀÂÃÉÈÊÍÌÓÒÔÕÚÙÇáàâãéèêíìóòôõúùç', 'AAAAEEEIIOOOUUCaaaaeeeiiooouuc'))) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM vi_ant b WHERE b.vendedor = a.vendedor
          AND upper(translate(split_part(b.cidade, '/', 1), 'ÁÀÂÃÉÈÊÍÌÓÒÔÕÚÙÇáàâãéèêíìóòôõúùç', 'AAAAEEEIIOOOUUCaaaaeeeiiooouuc'))
            = upper(translate(split_part(a.cidade, '/', 1), 'ÁÀÂÃÉÈÊÍÌÓÒÔÕÚÙÇáàâãéèêíìóòôõúùç', 'AAAAEEEIIOOOUUCaaaaeeeiiooouuc')))) cid_novos
    FROM vi_atual a
    WHERE a.vendedor <> 's/v'
    GROUP BY a.vendedor
  ),
  dev AS (
    SELECT COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'), ''), 's/v') cod,
           sum((f.raw->>'VALOR_LIQUIDO_ITEM')::numeric) dev_valor
    FROM public.ind_atak_fato f
    WHERE f.company_id = p_company_id AND f.dominio = 'comercial_devolucao' AND trim(f.raw->>'STATUS') <> 'C'
      AND left(f.raw->>'DATA_MOVTO', 10) BETWEEN to_char(p_dt_ini, 'YYYY-MM-DD') AND to_char(p_dt_fim, 'YYYY-MM-DD')
      AND (v_tipos_dev IS NULL OR f.raw->>'COD_TIPO_MV' = ANY (v_tipos_dev))
    GROUP BY 1
  ),
  ven_nome AS (
    SELECT COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'), ''), 's/v') cod,
           max(NULLIF(trim(f.raw->>'NOME_COMP'), '')) nome
    FROM public.ind_atak_fato f
    WHERE f.company_id = p_company_id AND f.dominio = 'comercial_venda_item'
      AND left(f.raw->>'DATA_MOVTO', 10) BETWEEN to_char(p_dt_ini, 'YYYY-MM-DD') AND to_char(p_dt_fim, 'YYYY-MM-DD')
    GROUP BY 1
  ),
  base AS (
    SELECT a.cod, COALESCE(vn.nome, a.cod) nome, a.fat, a.vol, a.cli, a.cid,
      COALESCE(n.cli_novos, 0) cli_novos, COALESCE(n.cid_novos, 0) cid_novos,
      CASE WHEN a.vol > 0 THEN a.fat / a.vol END preco_kg,
      CASE WHEN a.exp_val > 0 THEN a.fat / a.exp_val * 100 END indice_preco,
      CASE WHEN a.vtab > 0 THEN (a.vtab - a.fat) / a.vtab * 100 END desconto_pct,
      CASE WHEN COALESCE(b.fat_ant, 0) > 0 THEN (a.fat - b.fat_ant) / b.fat_ant * 100 END cresc_fat,
      CASE WHEN COALESCE(b.vol_ant, 0) > 0 THEN (a.vol - b.vol_ant) / b.vol_ant * 100 END cresc_vol,
      CASE WHEN a.fat > 0 THEN COALESCE(d.dev_valor, 0) / a.fat * 100 ELSE 0 END dev_pct
    FROM atual a
    LEFT JOIN ant b ON b.cod = a.cod
    LEFT JOIN novos n ON n.cod = a.cod
    LEFT JOIN dev d ON d.cod = a.cod
    LEFT JOIN ven_nome vn ON vn.cod = a.cod
  ),
  capped AS (
    SELECT base.*, least(100, greatest(0, cresc_fat)) cfc, least(100, greatest(0, cresc_vol)) cvc FROM base
  ),
  piso AS ( SELECT COALESCE(max(vol), 0) * 0.05 pk FROM capped ),
  flagged AS ( SELECT capped.*, (vol < (SELECT pk FROM piso)) abaixo_min FROM capped ),
  mm AS (
    SELECT min(fat) fat_mn, max(fat) fat_mx, min(vol) vol_mn, max(vol) vol_mx,
           min(cli) cli_mn, max(cli) cli_mx, min(cli_novos) cn_mn, max(cli_novos) cn_mx,
           min(cid) cid_mn, max(cid) cid_mx, min(cid_novos) dn_mn, max(cid_novos) dn_mx,
           min(indice_preco) ip_mn, max(indice_preco) ip_mx, min(desconto_pct) ds_mn, max(desconto_pct) ds_mx,
           min(dev_pct) dv_mn, max(dev_pct) dv_mx, min(cfc) cf_mn, max(cfc) cf_mx, min(cvc) cv_mn, max(cvc) cv_mx
    FROM flagged WHERE NOT abaixo_min
  ),
  calc AS (
    SELECT g.*,
      public.fn_norm_0_100(g.fat, m.fat_mn, m.fat_mx, true)       s_fat,
      public.fn_norm_0_100(g.vol, m.vol_mn, m.vol_mx, true)       s_vol,
      public.fn_norm_0_100(g.cli, m.cli_mn, m.cli_mx, true)       s_cli_a,
      public.fn_norm_0_100(g.cli_novos, m.cn_mn, m.cn_mx, true)   s_cli_n,
      public.fn_norm_0_100(g.cid, m.cid_mn, m.cid_mx, true)       s_cid_a,
      public.fn_norm_0_100(g.cid_novos, m.dn_mn, m.dn_mx, true)   s_cid_n,
      public.fn_norm_0_100(g.indice_preco, m.ip_mn, m.ip_mx, true) s_preco,
      public.fn_norm_0_100(g.desconto_pct, m.ds_mn, m.ds_mx, false) s_desc,
      public.fn_norm_0_100(g.dev_pct, m.dv_mn, m.dv_mx, false)    s_dev,
      public.fn_norm_0_100(g.cfc, m.cf_mn, m.cf_mx, true)        s_cf,
      public.fn_norm_0_100(g.cvc, m.cv_mn, m.cv_mx, true)        s_cv
    FROM flagged g CROSS JOIN mm m
  ),
  notas AS (
    SELECT c.*, round((c.s_cli_a + c.s_cli_n) / 2.0, 1) s_cli, round((c.s_cid_a + c.s_cid_n) / 2.0, 1) s_cid
    FROM calc c
  ),
  blocos AS (
    SELECT n.*,
      round(0.25 * n.s_fat + 0.25 * n.s_cf + 0.125 * n.s_vol + 0.125 * n.s_cv + 0.25 * ((n.s_cli + n.s_cid) / 2.0), 1) bloco_crescimento,
      round(0.40 * n.s_preco + 0.30 * n.s_desc + 0.30 * n.s_dev, 1) bloco_margem
    FROM notas n
  ),
  final AS (
    SELECT b.*, round(v_pc * b.bloco_crescimento + v_pm * b.bloco_margem, 1) nota_final FROM blocos b
  )
  SELECT jsonb_build_object(
    'ok', true, 'escopo', v_scope->>'modo', 'base', 'carne (sem despojo/subproduto)',
    'periodo', jsonb_build_object('de', p_dt_ini, 'ate', p_dt_fim, 'de_ant', p_dt_ini_ant, 'ate_ant', p_dt_fim_ant),
    'pesos', jsonb_build_object('crescimento', round(v_pc, 3), 'margem', round(v_pm, 3)),
    'piso_kg', (SELECT round(pk, 0) FROM piso),
    'vendedores', COALESCE(jsonb_agg(jsonb_build_object(
        'cod', cod, 'nome', nome, 'abaixo_minimo', abaixo_min,
        'indicadores', jsonb_build_object(
          'faturamento', round(fat, 2), 'volume_kg', round(vol, 0), 'clientes', cli, 'clientes_novos', cli_novos,
          'cidades', cid, 'cidades_novas', cid_novos, 'preco_kg', round(preco_kg, 2),
          'indice_preco', round(indice_preco, 1), 'desconto_pct', round(desconto_pct, 1),
          'acrescimo_pct', CASE WHEN desconto_pct < 0 THEN round(-desconto_pct, 1) ELSE NULL END,
          'devolucao_pct', round(dev_pct, 1), 'crescimento_fat_pct', round(cresc_fat, 1),
          'crescimento_vol_pct', round(cresc_vol, 1)),
        'notas', jsonb_build_object(
          'faturamento', s_fat, 'volume', s_vol, 'crescimento_fat', s_cf, 'crescimento_vol', s_cv,
          'clientes', s_cli, 'cidades', s_cid, 'preco', s_preco, 'desconto', s_desc, 'devolucao', s_dev),
        'bloco_crescimento', CASE WHEN abaixo_min THEN NULL ELSE bloco_crescimento END,
        'bloco_margem',      CASE WHEN abaixo_min THEN NULL ELSE bloco_margem END,
        'nota_final',        CASE WHEN abaixo_min THEN NULL ELSE nota_final END)
      ORDER BY abaixo_min, nota_final DESC NULLS LAST, fat DESC), '[]'::jsonb),
    'podio', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('pos', pos, 'cod', cod, 'nome', nome, 'nota_final', nota_final) ORDER BY pos)
      FROM (SELECT cod, nome, nota_final, row_number() OVER (ORDER BY nota_final DESC, fat DESC) pos
            FROM final WHERE NOT abaixo_min) p WHERE pos <= 3), '[]'::jsonb)
  ) INTO v_out FROM final;

  RETURN v_out;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_bi_comercial_ranking_pontuacao(uuid, date, date, date, date, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_ranking_pontuacao(uuid, date, date, date, date, numeric, numeric) TO authenticated, service_role;
