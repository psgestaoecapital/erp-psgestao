-- Ranking de vendedores (premiação por desempenho) — V1 apresentável (CEO 12/11, contexto a059298b).
-- Cada indicador vira nota 0-100 (melhor do período = 100); nota final = média ponderada de dois blocos:
--   BLOCO CRESCIMENTO = faturamento (peso maior) + crescimento vs período anterior + volume + positivação
--                       (nº de clientes e cidades);
--   BLOCO MARGEM/QUALIDADE = preço médio R$/kg vs empresa + disciplina de desconto + devolução real.
-- Pesos configuráveis por empresa (parâmetros); padrão 50% × 50% (V1 fixo; edição de pesos fica para V2).
-- Piso mínimo de carteira: vendedor com volume ínfimo é marcado "abaixo do mínimo" e NÃO sobe ao pódio
-- (evita liderar por % sobre base pequena), sem nota inflada.
--
-- SÓ LEITURA, aditiva (2 funções novas). Reusa a MV de venda (bi_comercial_venda_item_mv), o domínio de
-- devolução (mesmos tipos configuráveis da migration 20261114121045) e a hierarquia de vendedor
-- (comercial_hierarquia). Guarda: só 'lider' (diretor/gestor) vê o ranking (fn_bi_comercial_scope).

-- Normalização 0-100 (melhor=100). higher=false para indicadores em que MENOR é melhor (desconto, devolução).
CREATE OR REPLACE FUNCTION public.fn_norm_0_100(v numeric, mn numeric, mx numeric, higher boolean DEFAULT true)
 RETURNS numeric
 LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE
           WHEN v IS NULL OR mn IS NULL OR mx IS NULL THEN 0
           WHEN mx = mn THEN 100
           WHEN higher THEN round(100 * (v - mn) / (mx - mn), 1)
           ELSE round(100 * (mx - v) / (mx - mn), 1)
         END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_bi_comercial_ranking_pontuacao(
  p_company_id uuid, p_dt_ini date, p_dt_fim date,
  p_dt_ini_ant date, p_dt_fim_ant date,
  p_peso_crescimento numeric DEFAULT 0.5, p_peso_margem numeric DEFAULT 0.5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope jsonb; v_out jsonb; v_pc numeric; v_pm numeric; v_piso numeric;
  v_tipos_dev text[];
BEGIN
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' <> 'lider' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial');
  END IF;

  -- Pesos: padrão 50/50; normaliza para somar 1 (nunca hardcode do valor de negócio — vem por parâmetro).
  v_pc := COALESCE(NULLIF(p_peso_crescimento, 0), 0.5);
  v_pm := COALESCE(NULLIF(p_peso_margem, 0), 0.5);
  IF (v_pc + v_pm) <= 0 THEN v_pc := 0.5; v_pm := 0.5; END IF;
  SELECT v_pc / (v_pc + v_pm), v_pm / (v_pc + v_pm) INTO v_pc, v_pm;

  -- Tipos de devolução configurados (migration 20261114121045). Independente dela: se ainda não foi
  -- aplicada, cai no padrão T582/T583 (rede de segurança — a fonte de verdade é a config quando existe).
  BEGIN
    SELECT array_agg(cod_tipo_mv) INTO v_tipos_dev
      FROM public.fn_comercial_tipos_efetivos(p_company_id, 'devolucao_abate');
  EXCEPTION WHEN undefined_function OR undefined_table THEN
    v_tipos_dev := ARRAY['T582', 'T583'];
  END;
  IF v_tipos_dev IS NULL OR cardinality(v_tipos_dev) = 0 THEN
    v_tipos_dev := ARRAY['T582', 'T583'];
  END IF;

  WITH atual AS (
    SELECT m.vendedor cod, sum(m.valor) fat, sum(m.kg) vol,
           count(DISTINCT m.cliente_cod) cli, count(DISTINCT m.cidade) cid,
           sum(m.valor_tabela) vtab
    FROM public.bi_comercial_venda_item_mv m
    WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini AND p_dt_fim
    GROUP BY m.vendedor
  ),
  ant AS (
    SELECT m.vendedor cod, sum(m.valor) fat_ant, sum(m.kg) vol_ant
    FROM public.bi_comercial_venda_item_mv m
    WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini_ant AND p_dt_fim_ant
    GROUP BY m.vendedor
  ),
  dev AS (
    SELECT COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'), ''), 's/v') cod,
           sum((f.raw->>'VALOR_LIQUIDO_ITEM')::numeric) dev_valor
    FROM public.ind_atak_fato f
    WHERE f.company_id = p_company_id AND f.dominio = 'comercial_devolucao'
      AND trim(f.raw->>'STATUS') <> 'C'
      AND left(f.raw->>'DATA_MOVTO', 10) BETWEEN to_char(p_dt_ini, 'YYYY-MM-DD') AND to_char(p_dt_fim, 'YYYY-MM-DD')
      AND (v_tipos_dev IS NULL OR f.raw->>'COD_TIPO_MV' = ANY (v_tipos_dev))
    GROUP BY 1
  ),
  -- nome do vendedor pelo próprio raw da venda (NOME_COMP), como na fn_bi_comercial_base; cai no código se vazio
  ven_nome AS (
    SELECT COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'), ''), 's/v') cod,
           max(NULLIF(trim(f.raw->>'NOME_COMP'), '')) nome
    FROM public.ind_atak_fato f
    WHERE f.company_id = p_company_id AND f.dominio = 'comercial_venda_item'
      AND left(f.raw->>'DATA_MOVTO', 10) BETWEEN to_char(p_dt_ini, 'YYYY-MM-DD') AND to_char(p_dt_fim, 'YYYY-MM-DD')
    GROUP BY 1
  ),
  base AS (
    SELECT a.cod,
      COALESCE(vn.nome, a.cod) nome,
      a.fat, a.vol, a.cli, a.cid,
      CASE WHEN a.vol > 0 THEN a.fat / a.vol END preco,
      CASE WHEN a.vtab > 0 THEN (a.vtab - a.fat) / a.vtab * 100 END desconto_pct,
      CASE WHEN COALESCE(b.fat_ant, 0) > 0 THEN (a.fat - b.fat_ant) / b.fat_ant * 100 END cresc_fat,
      CASE WHEN COALESCE(b.vol_ant, 0) > 0 THEN (a.vol - b.vol_ant) / b.vol_ant * 100 END cresc_vol,
      CASE WHEN a.fat > 0 THEN COALESCE(d.dev_valor, 0) / a.fat * 100 ELSE 0 END dev_pct
    FROM atual a
    LEFT JOIN ant b ON b.cod = a.cod
    LEFT JOIN dev d ON d.cod = a.cod
    LEFT JOIN ven_nome vn ON vn.cod = a.cod
  ),
  piso AS ( SELECT COALESCE(max(vol), 0) * 0.05 pk FROM base ),  -- 5% do volume do líder
  flagged AS ( SELECT base.*, (vol < (SELECT pk FROM piso)) abaixo_min FROM base ),
  -- réguas (min/max) calculadas só entre quem está ACIMA do piso, para não distorcer a normalização
  mm AS (
    SELECT min(fat) fat_mn, max(fat) fat_mx, min(vol) vol_mn, max(vol) vol_mx,
           min(cli) cli_mn, max(cli) cli_mx, min(cid) cid_mn, max(cid) cid_mx,
           min(preco) pr_mn, max(preco) pr_mx, min(desconto_pct) ds_mn, max(desconto_pct) ds_mx,
           min(dev_pct) dv_mn, max(dev_pct) dv_mx, min(cresc_fat) cf_mn, max(cresc_fat) cf_mx,
           min(cresc_vol) cv_mn, max(cresc_vol) cv_mx
    FROM flagged WHERE NOT abaixo_min
  ),
  calc AS (
    SELECT g.*,
      public.fn_norm_0_100(g.fat,  m.fat_mn, m.fat_mx, true)  s_fat,
      public.fn_norm_0_100(g.vol,  m.vol_mn, m.vol_mx, true)  s_vol,
      public.fn_norm_0_100(g.cli,  m.cli_mn, m.cli_mx, true)  s_cli,
      public.fn_norm_0_100(g.cid,  m.cid_mn, m.cid_mx, true)  s_cid,
      public.fn_norm_0_100(g.preco, m.pr_mn, m.pr_mx, true)   s_preco,
      public.fn_norm_0_100(g.desconto_pct, m.ds_mn, m.ds_mx, false) s_desc,
      public.fn_norm_0_100(g.dev_pct, m.dv_mn, m.dv_mx, false) s_dev,
      public.fn_norm_0_100(g.cresc_fat, m.cf_mn, m.cf_mx, true) s_cf,
      public.fn_norm_0_100(g.cresc_vol, m.cv_mn, m.cv_mx, true) s_cv
    FROM flagged g CROSS JOIN mm m
  ),
  notas AS (
    SELECT c.*,
      round((2 * c.s_fat + c.s_cf + c.s_vol + c.s_cv + c.s_cli + c.s_cid) / 7.0, 1) bloco_crescimento,
      round((c.s_preco + c.s_desc + c.s_dev) / 3.0, 1) bloco_margem
    FROM calc c
  ),
  final AS (
    SELECT n.*, round(v_pc * n.bloco_crescimento + v_pm * n.bloco_margem, 1) nota_final
    FROM notas n
  )
  SELECT jsonb_build_object(
    'ok', true,
    'escopo', v_scope->>'modo',
    'periodo', jsonb_build_object('de', p_dt_ini, 'ate', p_dt_fim, 'de_ant', p_dt_ini_ant, 'ate_ant', p_dt_fim_ant),
    'pesos', jsonb_build_object('crescimento', round(v_pc, 3), 'margem', round(v_pm, 3)),
    'piso_kg', (SELECT round(pk, 0) FROM piso),
    'vendedores', COALESCE(jsonb_agg(jsonb_build_object(
        'cod', cod, 'nome', nome, 'abaixo_minimo', abaixo_min,
        'indicadores', jsonb_build_object(
          'faturamento', round(fat, 2), 'volume_kg', round(vol, 0), 'clientes', cli, 'cidades', cid,
          'preco_kg', round(preco, 2), 'desconto_pct', round(desconto_pct, 1),
          'devolucao_pct', round(dev_pct, 1), 'crescimento_fat_pct', round(cresc_fat, 1),
          'crescimento_vol_pct', round(cresc_vol, 1)),
        'notas', jsonb_build_object(
          'faturamento', s_fat, 'volume', s_vol, 'clientes', s_cli, 'cidades', s_cid,
          'preco', s_preco, 'desconto', s_desc, 'devolucao', s_dev,
          'crescimento_fat', s_cf, 'crescimento_vol', s_cv),
        'bloco_crescimento', bloco_crescimento, 'bloco_margem', bloco_margem, 'nota_final', nota_final)
      ORDER BY abaixo_min, nota_final DESC, fat DESC), '[]'::jsonb),
    'podio', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('pos', pos, 'cod', cod, 'nome', nome, 'nota_final', nota_final) ORDER BY pos)
      FROM (SELECT cod, nome, nota_final, row_number() OVER (ORDER BY nota_final DESC, fat DESC) pos
            FROM final WHERE NOT abaixo_min) p WHERE pos <= 3), '[]'::jsonb)
  ) INTO v_out FROM final;

  RETURN v_out;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_bi_comercial_ranking_pontuacao(uuid, date, date, date, date, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_ranking_pontuacao(uuid, date, date, date, date, numeric, numeric) TO authenticated;

-- Ajuda de campo (RD-95) — "Como é calculado" e colunas do ranking.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT * FROM (VALUES
  ('comercial.ranking.como', '/dashboard/comercial/meu-painel', 'Ranking', 'Como é calculado',
   'Nada a preencher. Cada indicador vira uma nota de 0 a 100 (o melhor do período fica com 100). A nota final é a média de dois blocos.',
   'Ranqueia os vendedores de forma transparente: Crescimento (faturamento — que pesa mais —, crescimento vs período anterior, volume e positivação de clientes/cidades) vale 50%, e Margem/qualidade (preço médio R$/kg vs empresa, disciplina de desconto e devolução) vale 50%. Pesos editáveis por empresa em breve.',
   'Quem mais cresceu e vendeu com boa margem fica no topo. Mês e ano são placares separados.',
   'Comparar a nota de meses diferentes como se fosse valor absoluto: a nota é relativa ao período (o melhor do período é 100).',
   'comercial', 50, 'publicado'),
  ('comercial.ranking.nota_final', '/dashboard/comercial/meu-painel', 'Ranking', 'Nota final',
   'Nada a preencher: média ponderada dos blocos Crescimento (50%) e Margem/qualidade (50%).',
   'É a nota que define o pódio e a ordem da tabela.',
   'Bloco crescimento 82 e margem 70 → nota final 76.',
   'Achar que é faturamento: é uma nota 0-100, não R$.',
   'comercial', 51, 'publicado'),
  ('comercial.ranking.piso', '/dashboard/comercial/meu-painel', 'Ranking', 'Abaixo do mínimo',
   'Nada a preencher: marca quem tem volume de carteira ínfimo no período (abaixo de 5% do líder de volume).',
   'Evita que um vendedor lidere por percentual sobre uma base pequena. Fica fora do pódio, mas aparece na tabela.',
   'Vendedor com 300 kg no mês enquanto o líder fez 80 t: marcado "abaixo do mínimo".',
   'Premiar nota alta de quem quase não vendeu.',
   'comercial', 52, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.rota = v.rota AND e.chave = v.chave);
