-- Ranking de vendedores — correção V1 apresentável (CEO 12/11). Corpo FINAL unificado da função: aplica SOBRE a
-- migration de participantes (20261114150145, participantes + acréscimo), que roda ANTES desta no ledger
-- (150145 < 150245). Unifica numa PR só as antigas #4813 (este corpo) e #4814 (tabela/participantes): o corpo
-- abaixo é o que vale — mantém TUDO da parte de participantes (exclusão dos desmarcados em
-- com_ranking_participante + acrescimo_pct) e acrescenta as correções provadas no dado real da Frioeste (RD-82/RD-38).
--
-- O que estava errado no corpo da #4810/#4814 (prova como diretor da Frioeste):
--   1) 's/v' (sem vendedor) entrava como vendedor e, no placar do ano, saía com nota_final 8958 (fn_norm_0_100 sem
--      limite 0-100 deixava o abaixo-do-piso estourar a régua).
--   2) base com TODAS as linhas (com despojo): a sócia-diretora FRANCIELE (258 t de despojo a R$1,31/kg) subia ao
--      pódio e os 258 t dela viravam a régua de volume, esmagando a nota dos vendedores de verdade.
--   3) preço R$/kg cru (não o índice vs a empresa).
--   4) faltava clientes/cidades NOVOS na positivação; mês era o corrente parcial (front), não o mês FECHADO.
--
-- Correções (mesma assinatura e grants): a) base CARNE (sem despojo/subproduto — 96% do faturamento) e exclui 's/v';
--   b) fn_norm_0_100 LIMITA a [0,100]; c) preço vira ÍNDICE (faturamento ÷ esperado ao preço médio da empresa por
--   produto, ajustado pelo mix); d) positivação = clientes (ativos+novos) e cidades (ativas+novas); e) bloco
--   Crescimento pontua ABSOLUTO E CRESCIMENTO de faturamento e volume (CEO 12/11 — quem mais vende E quem mais cresce);
--   f) abaixo do mínimo não recebe nota final (fora do pódio, sem nota inflada). Mantém a exclusão de participantes
--   desmarcados (#4814) e o acrescimo_pct. SÓ LEITURA, aditiva (CREATE OR REPLACE de 2 funções).

-- Normalização 0-100 (melhor=100), AGORA limitada a [0,100] (o abaixo-do-piso nunca estoura a régua).
CREATE OR REPLACE FUNCTION public.fn_norm_0_100(v numeric, mn numeric, mx numeric, higher boolean DEFAULT true)
 RETURNS numeric
 LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE
           WHEN v IS NULL OR mn IS NULL OR mx IS NULL THEN 0
           WHEN mx = mn THEN 100
           WHEN higher THEN greatest(0, least(100, round(100 * (v - mn) / (mx - mn), 1)))
           ELSE          greatest(0, least(100, round(100 * (mx - v) / (mx - mn), 1)))
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
  v_scope jsonb; v_out jsonb; v_pc numeric; v_pm numeric; v_tipos_dev text[];
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

  WITH
  -- Preço médio da empresa por produto, base CARNE do período atual (para o índice ajustado pelo mix).
  preco_prod AS (
    SELECT m.produto_cod, sum(m.valor) / NULLIF(sum(m.kg), 0) p
    FROM public.bi_comercial_venda_item_mv m
    WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini AND p_dt_fim AND m.carne AND m.kg > 0
    GROUP BY m.produto_cod
  ),
  atual AS (
    SELECT m.vendedor cod, sum(m.valor) fat, sum(m.kg) vol,
           count(DISTINCT m.cliente_cod) cli,
           count(DISTINCT upper(translate(split_part(m.cidade, '/', 1), 'ÁÀÂÃÉÈÊÍÌÓÒÔÕÚÙÇáàâãéèêíìóòôõúùç', 'AAAAEEEIIOOOUUCaaaaeeeiiooouuc'))) cid,
           sum(m.valor_tabela) vtab,
           sum(COALESCE(m.kg, 0) * COALESCE(pp.p, 0)) exp_val
    FROM public.bi_comercial_venda_item_mv m
    LEFT JOIN preco_prod pp ON pp.produto_cod = m.produto_cod
    WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini AND p_dt_fim AND m.carne AND m.vendedor <> 's/v'
      -- CEO 12/11 (#4814): exclui quem o gestor desmarcou do ranking (ex. diretor/sócio). Ausência de linha = incluído.
      AND NOT EXISTS (
        SELECT 1 FROM public.com_ranking_participante rp
         WHERE rp.company_id = p_company_id AND rp.cod_vendedor = m.vendedor AND rp.incluido = false)
    GROUP BY m.vendedor
  ),
  ant AS (
    SELECT m.vendedor cod, sum(m.valor) fat_ant, sum(m.kg) vol_ant
    FROM public.bi_comercial_venda_item_mv m
    WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini_ant AND p_dt_fim_ant AND m.carne AND m.vendedor <> 's/v'
    GROUP BY m.vendedor
  ),
  -- Positivação: clientes e cidades que compraram no atual e NÃO compraram no período anterior (novos).
  novos AS (
    SELECT a.vendedor cod,
      count(DISTINCT a.cliente_cod) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM public.bi_comercial_venda_item_mv b
        WHERE b.company_id = p_company_id AND b.dia BETWEEN p_dt_ini_ant AND p_dt_fim_ant AND b.carne
          AND b.vendedor = a.vendedor AND b.cliente_cod = a.cliente_cod)) cli_novos,
      count(DISTINCT upper(translate(split_part(a.cidade, '/', 1), 'ÁÀÂÃÉÈÊÍÌÓÒÔÕÚÙÇáàâãéèêíìóòôõúùç', 'AAAAEEEIIOOOUUCaaaaeeeiiooouuc'))) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM public.bi_comercial_venda_item_mv b
        WHERE b.company_id = p_company_id AND b.dia BETWEEN p_dt_ini_ant AND p_dt_fim_ant AND b.carne AND b.vendedor = a.vendedor
          AND upper(translate(split_part(b.cidade, '/', 1), 'ÁÀÂÃÉÈÊÍÌÓÒÔÕÚÙÇáàâãéèêíìóòôõúùç', 'AAAAEEEIIOOOUUCaaaaeeeiiooouuc'))
            = upper(translate(split_part(a.cidade, '/', 1), 'ÁÀÂÃÉÈÊÍÌÓÒÔÕÚÙÇáàâãéèêíìóòôõúùç', 'AAAAEEEIIOOOUUCaaaaeeeiiooouuc')))) cid_novos
    FROM public.bi_comercial_venda_item_mv a
    WHERE a.company_id = p_company_id AND a.dia BETWEEN p_dt_ini AND p_dt_fim AND a.carne AND a.vendedor <> 's/v'
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
      CASE WHEN a.exp_val > 0 THEN a.fat / a.exp_val * 100 END indice_preco,   -- 100 = no preço médio da empresa p/ o mix dele
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
  -- Crescimento entra na régua limitado a [0,100]% (queda e estabilidade = 0; base pequena não distorce).
  capped AS (
    SELECT base.*, least(100, greatest(0, cresc_fat)) cfc, least(100, greatest(0, cresc_vol)) cvc FROM base
  ),
  piso AS ( SELECT COALESCE(max(vol), 0) * 0.05 pk FROM capped ),  -- 5% do volume (carne) do líder
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
      public.fn_norm_0_100(g.fat, m.fat_mn, m.fat_mx, true)             s_fat,   -- faturamento ABSOLUTO
      public.fn_norm_0_100(g.vol, m.vol_mn, m.vol_mx, true)             s_vol,   -- volume ABSOLUTO
      public.fn_norm_0_100(g.cli, m.cli_mn, m.cli_mx, true)             s_cli_a,
      public.fn_norm_0_100(g.cli_novos, m.cn_mn, m.cn_mx, true)         s_cli_n,
      public.fn_norm_0_100(g.cid, m.cid_mn, m.cid_mx, true)             s_cid_a,
      public.fn_norm_0_100(g.cid_novos, m.dn_mn, m.dn_mx, true)         s_cid_n,
      public.fn_norm_0_100(g.indice_preco, m.ip_mn, m.ip_mx, true)      s_preco,
      -- disciplina de preço: MENOR desconto_pct é melhor (acréscimo = desconto_pct negativo = nota 100).
      public.fn_norm_0_100(g.desconto_pct, m.ds_mn, m.ds_mx, false)     s_desc,
      public.fn_norm_0_100(g.dev_pct, m.dv_mn, m.dv_mx, false)          s_dev,
      public.fn_norm_0_100(g.cfc, m.cf_mn, m.cf_mx, true)              s_cf,    -- crescimento de faturamento
      public.fn_norm_0_100(g.cvc, m.cv_mn, m.cv_mx, true)              s_cv     -- crescimento de volume
    FROM flagged g CROSS JOIN mm m
  ),
  notas AS (
    SELECT c.*,
      round((c.s_cli_a + c.s_cli_n) / 2.0, 1) s_cli,   -- clientes: ativos + novos
      round((c.s_cid_a + c.s_cid_n) / 2.0, 1) s_cid    -- cidades: ativas + novas
    FROM calc c
  ),
  blocos AS (
    SELECT n.*,
      -- Crescimento: faturamento (absoluto 0.25 + crescimento 0.25) + volume (absoluto 0.125 + crescimento 0.125) + positivação 0.25.
      round(0.25 * n.s_fat + 0.25 * n.s_cf + 0.125 * n.s_vol + 0.125 * n.s_cv + 0.25 * ((n.s_cli + n.s_cid) / 2.0), 1) bloco_crescimento,
      round(0.40 * n.s_preco + 0.30 * n.s_desc + 0.30 * n.s_dev, 1) bloco_margem
    FROM notas n
  ),
  final AS (
    SELECT b.*, round(v_pc * b.bloco_crescimento + v_pm * b.bloco_margem, 1) nota_final
    FROM blocos b
  )
  SELECT jsonb_build_object(
    'ok', true,
    'escopo', v_scope->>'modo',
    'base', 'carne (sem despojo/subproduto)',
    'periodo', jsonb_build_object('de', p_dt_ini, 'ate', p_dt_fim, 'de_ant', p_dt_ini_ant, 'ate_ant', p_dt_fim_ant),
    'pesos', jsonb_build_object('crescimento', round(v_pc, 3), 'margem', round(v_pm, 3)),
    'piso_kg', (SELECT round(pk, 0) FROM piso),
    'vendedores', COALESCE(jsonb_agg(jsonb_build_object(
        'cod', cod, 'nome', nome, 'abaixo_minimo', abaixo_min,
        'indicadores', jsonb_build_object(
          'faturamento', round(fat, 2), 'volume_kg', round(vol, 0), 'clientes', cli, 'clientes_novos', cli_novos,
          'cidades', cid, 'cidades_novas', cid_novos, 'preco_kg', round(preco_kg, 2),
          'indice_preco', round(indice_preco, 1), 'desconto_pct', round(desconto_pct, 1),
          -- acréscimo = vendeu acima da tabela (desconto_pct negativo). Positivo e verde na tela (#4814).
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

REVOKE ALL ON FUNCTION public.fn_bi_comercial_ranking_pontuacao(uuid, date, date, date, date, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_ranking_pontuacao(uuid, date, date, date, date, numeric, numeric) TO authenticated;

-- RD-95: atualiza o texto "Como é calculado" e "Abaixo do mínimo" para o modelo final; "?" novo do índice de preço.
UPDATE public.erp_ajuda_campo SET
  o_que_preencher = 'Nada a preencher. Cada indicador vira uma nota de 0 a 100 (o melhor do período fica com 100). A nota final é a média de dois blocos.',
  para_que_serve = 'Ranqueia os vendedores de forma transparente, sobre as vendas de carne (sem despojo/subproduto). Crescimento (faturamento e volume — tanto o total do período quanto o crescimento vs o período anterior — e positivação de clientes/cidades, ativos e novos) vale 50%; Margem/qualidade (índice de preço vs a média da empresa, disciplina de desconto e devolução) vale 50%. Pesos editáveis por empresa em breve.',
  exemplo = 'Mês = último mês fechado vs o mês anterior; Ano = do 1º de janeiro até o fim do mês fechado vs o mesmo intervalo do ano passado.',
  erro_comum = 'Comparar a nota de meses diferentes como valor absoluto: a nota é relativa ao período (o melhor do período é 100).'
WHERE rota = '/dashboard/comercial/meu-painel' AND chave = 'comercial.ranking.como';

UPDATE public.erp_ajuda_campo SET
  para_que_serve = 'Evita que um vendedor lidere por percentual sobre uma base pequena. Mede o volume de carne no período; abaixo de 5% do líder de volume fica "abaixo do mínimo" — fora do pódio e sem nota final, mas aparece na tabela.'
WHERE rota = '/dashboard/comercial/meu-painel' AND chave = 'comercial.ranking.piso';

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT * FROM (VALUES
  ('comercial.ranking.preco', '/dashboard/comercial/meu-painel', 'Ranking', 'Índice de preço',
   'Nada a preencher: índice de preço do vendedor vs a média da empresa.',
   'Faturamento do vendedor ÷ o que ele faturaria ao preço médio da empresa para o MESMO mix de produtos. 100 = no preço médio; acima = vende mais caro; abaixo = mais barato. Ajustado pelo mix (justo com corte nobre ou despojo).',
   'Vendeu R$ 1,05 para cada R$ 1,00 esperado ao preço médio → índice 105 → boa nota de preço.',
   'Achar que é R$/kg cru: dois vendedores com mix diferente não se comparam por R$/kg direto; o índice ajusta o mix.',
   'comercial', 55, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.rota = v.rota AND e.chave = v.chave);
