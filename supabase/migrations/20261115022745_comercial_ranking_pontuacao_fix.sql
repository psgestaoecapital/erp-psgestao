-- Ranking de vendedores — V1 apresentável, MIGRATION ÚNICA (CEO 12/11, contexto a059298b).
-- Consolida numa só migration a tabela/RPCs de "participantes" (antes #4814) + o corpo FINAL da pontuação, para não
-- duplicar objeto nem reescrever a função em duas versões (RD-52) e não ter hazard de ordem de deploy (RD-97).
-- A #4814 fica superseded (fechar ou nao-publicar). AjustesAntesDoMerge do gilberto-revisor atendidos:
--   (1) fórmula = ABSOLUTO + CRESCIMENTO (decisão do CEO, msg fa315023 — "pontuar quem mais vende E quem mais cresce");
--   (2) UMA migration da função + tabela/RPCs juntas, a outra PR fecha;
--   (3) fn_com_ranking_participante_definir com PERFORM public.fn__guarda_empresa (guarda real, não só comentário).
--
-- Corrige o bug real da Frioeste (prova RD-82/RD-38): FRANCIELE (diretora) subia ao pódio via despojo e esmagava a
-- régua de volume; 's/v' entrava como vendedor e no ano saía com nota 8958 (normalização sem limite); mês era o
-- corrente parcial; preço era R$/kg cru. Aqui: base CARNE (sem despojo), exclui 's/v', fn_norm_0_100 em [0,100],
-- índice de preço pelo mix, positivação com novos, mês FECHADO, abaixo do mínimo sem nota final; mais a seção
-- "Participantes" (o gestor desmarca quem não concorre) e o acréscimo explícito. SÓ LEITURA do BI; aditiva.

-- Normalização 0-100 (melhor=100), limitada a [0,100] (o abaixo-do-piso nunca estoura a régua).
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

-- ── Participantes do ranking: override por empresa (ausência de linha = incluído). ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.com_ranking_participante (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cod_vendedor   text NOT NULL CHECK (length(btrim(cod_vendedor)) > 0),
  incluido       boolean NOT NULL DEFAULT true,
  motivo         text,
  atualizado_por uuid,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, cod_vendedor)
);
COMMENT ON TABLE public.com_ranking_participante IS 'Ranking comercial: quem entra no ranking de vendedores, por empresa. Sem linha = incluído. Desmarcado (incluido=false) sai do pódio e da pontuação, mas continua no BI. Nunca altera o cadastro-raiz do vendedor nem o ATAK.';

ALTER TABLE public.com_ranking_participante ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.com_ranking_participante FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS com_ranking_participante_sel ON public.com_ranking_participante;
CREATE POLICY com_ranking_participante_sel ON public.com_ranking_participante FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
GRANT SELECT ON public.com_ranking_participante TO authenticated;
GRANT ALL ON public.com_ranking_participante TO service_role;

-- RPC: marcar/desmarcar um vendedor (só líder). Guarda real de empresa (fn__guarda_empresa) + fail-closed por escopo.
CREATE OR REPLACE FUNCTION public.fn_com_ranking_participante_definir(
  p_company_id uuid, p_cod_vendedor text, p_incluido boolean, p_motivo text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_scope jsonb; v_cod text := btrim(COALESCE(p_cod_vendedor, ''));
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);              -- guarda de empresa do registro (RAISE 42501 se não-membro)
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' <> 'lider' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial');
  END IF;
  IF v_cod = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'cod_vendedor_vazio');
  END IF;

  INSERT INTO public.com_ranking_participante (company_id, cod_vendedor, incluido, motivo, atualizado_por, atualizado_em)
  VALUES (p_company_id, v_cod, COALESCE(p_incluido, true), NULLIF(btrim(p_motivo), ''), auth.uid(), now())
  ON CONFLICT (company_id, cod_vendedor) DO UPDATE
    SET incluido = EXCLUDED.incluido, motivo = EXCLUDED.motivo,
        atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now();

  RETURN jsonb_build_object('ok', true, 'cod', v_cod, 'incluido', COALESCE(p_incluido, true));
END
$function$;
REVOKE ALL ON FUNCTION public.fn_com_ranking_participante_definir(uuid, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_com_ranking_participante_definir(uuid, text, boolean, text) TO authenticated, service_role;

-- RPC: listar vendedores com venda no período + a marca incluído (seção "Participantes"). Só líder.
CREATE OR REPLACE FUNCTION public.fn_com_ranking_participantes_listar(
  p_company_id uuid, p_dt_ini date, p_dt_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_scope jsonb; v_out jsonb;
BEGIN
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' <> 'lider' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial');
  END IF;
  WITH atual AS (
    SELECT m.vendedor cod, sum(m.kg) vol, sum(m.valor) fat
    FROM public.bi_comercial_venda_item_mv m
    WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini AND p_dt_fim
    GROUP BY m.vendedor
  ),
  ven_nome AS (
    SELECT COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'), ''), 's/v') cod,
           max(NULLIF(trim(f.raw->>'NOME_COMP'), '')) nome
    FROM public.ind_atak_fato f
    WHERE f.company_id = p_company_id AND f.dominio = 'comercial_venda_item'
      AND left(f.raw->>'DATA_MOVTO', 10) BETWEEN to_char(p_dt_ini, 'YYYY-MM-DD') AND to_char(p_dt_fim, 'YYYY-MM-DD')
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'ok', true,
    'periodo', jsonb_build_object('de', p_dt_ini, 'ate', p_dt_fim),
    'participantes', COALESCE(jsonb_agg(jsonb_build_object(
       'cod', a.cod, 'nome', COALESCE(vn.nome, a.cod), 'volume_kg', round(a.vol, 0),
       'faturamento', round(a.fat, 2), 'incluido', COALESCE(p.incluido, true), 'motivo', p.motivo)
       ORDER BY a.fat DESC NULLS LAST), '[]'::jsonb)
  ) INTO v_out
  FROM atual a
  LEFT JOIN ven_nome vn ON vn.cod = a.cod
  LEFT JOIN public.com_ranking_participante p ON p.company_id = p_company_id AND p.cod_vendedor = a.cod;
  RETURN v_out;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_com_ranking_participantes_listar(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_com_ranking_participantes_listar(uuid, date, date) TO authenticated, service_role;

-- ── Pontuação do ranking (corpo final). Exclui desmarcados + 's/v'; base carne; nota 0-100; índice de preço pelo
--    mix; positivação com novos; crescimento com ABSOLUTO e CRESCIMENTO; abaixo do mínimo sem nota. ───────────────
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
           sum(m.valor_tabela) vtab, sum(COALESCE(m.kg, 0) * COALESCE(pp.p, 0)) exp_val
    FROM public.bi_comercial_venda_item_mv m
    LEFT JOIN preco_prod pp ON pp.produto_cod = m.produto_cod
    WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini AND p_dt_fim AND m.carne AND m.vendedor <> 's/v'
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
REVOKE ALL ON FUNCTION public.fn_bi_comercial_ranking_pontuacao(uuid, date, date, date, date, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_ranking_pontuacao(uuid, date, date, date, date, numeric, numeric) TO authenticated;

-- ── Ajuda de campo (RD-95) ─────────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT * FROM (VALUES
  ('comercial.ranking.participantes', '/dashboard/comercial/meu-painel', 'Ranking', 'Participantes do ranking',
   'Marque ou desmarque quem entra no ranking. Por padrão, todos os vendedores com venda no período entram.',
   'Tira do pódio e da tabela de pontuação quem não deve ser ranqueado como vendedor — por exemplo um diretor ou sócio que também vende. Quem é desmarcado continua aparecendo no restante do BI comercial; só não concorre no ranking. Não altera o cadastro do vendedor.',
   'Desmarcar a sócia que vende para ela não competir com a equipe de vendas.',
   'Desmarcar um vendedor de verdade achando que some do BI: ele sai só do ranking, não dos relatórios.',
   'comercial', 53, 'publicado'),
  ('comercial.ranking.acrescimo', '/dashboard/comercial/meu-painel', 'Ranking', 'Acréscimo / desconto',
   'Nada a preencher. Mostra se o vendedor vendeu abaixo (desconto) ou ACIMA (acréscimo) da tabela de preços.',
   'Na nota de disciplina de preço, vender acima da tabela conta A FAVOR (acréscimo é bom) e desconto real conta contra. Quem pratica acréscimo recebe a melhor nota desse indicador.',
   'Vendedor com Costela +13,5% sobre a tabela aparece como "Acréscimo 13,5%" (verde) e ganha nota alta de preço.',
   'Ler acréscimo como se fosse desconto negativo ruim: acréscimo é positivo para a margem.',
   'comercial', 54, 'publicado'),
  ('comercial.ranking.preco', '/dashboard/comercial/meu-painel', 'Ranking', 'Índice de preço',
   'Nada a preencher: índice de preço do vendedor vs a média da empresa.',
   'Faturamento do vendedor ÷ o que ele faturaria ao preço médio da empresa para o MESMO mix de produtos. 100 = no preço médio; acima = vende mais caro; abaixo = mais barato. Ajustado pelo mix (justo com corte nobre ou despojo).',
   'Vendeu R$ 1,05 para cada R$ 1,00 esperado ao preço médio → índice 105 → boa nota de preço.',
   'Achar que é R$/kg cru: dois vendedores com mix diferente não se comparam por R$/kg direto; o índice ajusta o mix.',
   'comercial', 55, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.rota = v.rota AND e.chave = v.chave);

UPDATE public.erp_ajuda_campo SET
  o_que_preencher = 'Nada a preencher. Cada indicador vira uma nota de 0 a 100 (o melhor do período fica com 100). A nota final é a média de dois blocos.',
  para_que_serve = 'Ranqueia os vendedores de forma transparente, sobre as vendas de carne (sem despojo/subproduto). Crescimento (faturamento e volume — tanto o total do período quanto o crescimento vs o período anterior — e positivação de clientes/cidades, ativos e novos) vale 50%; Margem/qualidade (índice de preço vs a média da empresa, disciplina de desconto e devolução) vale 50%. Pesos editáveis por empresa em breve.',
  exemplo = 'Mês = último mês fechado vs o mês anterior; Ano = do 1º de janeiro até o fim do mês fechado vs o mesmo intervalo do ano passado.',
  erro_comum = 'Comparar a nota de meses diferentes como valor absoluto: a nota é relativa ao período (o melhor do período é 100).'
WHERE rota = '/dashboard/comercial/meu-painel' AND chave = 'comercial.ranking.como';

UPDATE public.erp_ajuda_campo SET
  para_que_serve = 'Evita que um vendedor lidere por percentual sobre uma base pequena. Mede o volume de carne no período; abaixo de 5% do líder de volume fica "abaixo do mínimo" — fora do pódio e sem nota final, mas aparece na tabela.'
WHERE rota = '/dashboard/comercial/meu-painel' AND chave = 'comercial.ranking.piso';
