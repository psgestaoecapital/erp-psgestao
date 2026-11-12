-- Ranking de vendedores — filtro "quem entra no ranking" + exclusão na pontuação (CEO 12/11, contexto a059298b).
-- Problema real auditado na Frioeste: diretor/sócio que também vende (ex. Franciele) aparecia no pódio e na tabela
-- de pontuação dos vendedores. O CEO pediu que o gestor marque/desmarque manualmente quem entra no ranking;
-- quem for desmarcado SAI do pódio e da tabela de pontuação, mas CONTINUA no BI comercial normal.
--
-- Observação de disciplina de preço (Entrega 1 — acréscimo): a nota de desconto JÁ premia acréscimo. O indicador
-- desconto_pct = (tabela − praticado)/tabela; vender ACIMA da tabela → desconto_pct negativo → mínimo da régua →
-- fn_norm_0_100(..., higher=false) devolve 100. Ou seja, acréscimo recebe a MELHOR nota e desconto real a pior
-- (correto). O sinal invertido era só de EXIBIÇÃO (tratado na tela). Aqui não se mexe na normalização.
--
-- SÓ LEITURA do BI; aditiva: 1 tabela nova (RLS por empresa, REVOKE anon, escrita só via RPC de líder) + 2 RPCs
-- novas + CREATE OR REPLACE da fn de pontuação só para EXCLUIR os desmarcados. Guarda 'lider' (fn_bi_comercial_scope).

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 1) Tabela: participante do ranking por empresa (override; ausência de linha = incluído por padrão).
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
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
COMMENT ON TABLE public.com_ranking_participante IS 'Ranking comercial: quem entra no ranking de vendedores, por empresa. Sem linha = incluído. Desmarcado (incluido=false) sai do pódio e da tabela de pontuação, mas continua no BI. Nunca altera o cadastro-raiz do vendedor nem o ATAK.';

ALTER TABLE public.com_ranking_participante ENABLE ROW LEVEL SECURITY;
-- Fail-closed: revoga tudo e concede só SELECT ao authenticated (por empresa). Escrita é exclusivamente pela RPC
-- de líder (SECURITY DEFINER) — não há GRANT de INSERT/UPDATE/DELETE direto, logo PostgREST não grava direto.
REVOKE ALL ON public.com_ranking_participante FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS com_ranking_participante_sel ON public.com_ranking_participante;
CREATE POLICY com_ranking_participante_sel ON public.com_ranking_participante FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
GRANT SELECT ON public.com_ranking_participante TO authenticated;
GRANT ALL ON public.com_ranking_participante TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 2) RPC: marcar/desmarcar um vendedor do ranking (só líder — diretor/gestor comercial). Fail-closed.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- ci-sem-guarda: fn_com_ranking_participante_definir — acesso à empresa do registro (p_company_id) já conferido por
--   fn_bi_comercial_scope: retorna sem_acesso quando a empresa não está em get_user_company_ids e exige modo='lider'
--   (mais restritivo que fn__guarda_empresa). A autoria grava auth.uid(), nunca p_user do cliente.
CREATE OR REPLACE FUNCTION public.fn_com_ranking_participante_definir(
  p_company_id uuid, p_cod_vendedor text, p_incluido boolean, p_motivo text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_scope jsonb; v_cod text := btrim(COALESCE(p_cod_vendedor, ''));
BEGIN
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
    SET incluido = EXCLUDED.incluido,
        motivo = EXCLUDED.motivo,
        atualizado_por = EXCLUDED.atualizado_por,
        atualizado_em = now();

  RETURN jsonb_build_object('ok', true, 'cod', v_cod, 'incluido', COALESCE(p_incluido, true));
END
$function$;
REVOKE ALL ON FUNCTION public.fn_com_ranking_participante_definir(uuid, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_com_ranking_participante_definir(uuid, text, boolean, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 3) RPC: listar TODOS os vendedores com venda no período + a marca incluído (para a seção "Participantes").
--    Mostra também os desmarcados (para poder reincluir). Independe da exclusão do ranking. Só líder.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
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
       'cod', a.cod,
       'nome', COALESCE(vn.nome, a.cod),
       'volume_kg', round(a.vol, 0),
       'faturamento', round(a.fat, 2),
       'incluido', COALESCE(p.incluido, true),
       'motivo', p.motivo)
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

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 4) Pontuação do ranking: EXCLUIR os desmarcados (incluido=false). Única mudança vs 20261114121145.
--    Os desmarcados saem já no CTE `atual`, logo não entram em base, piso, régua, notas nem pódio.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
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
  v_scope jsonb; v_out jsonb; v_pc numeric; v_pm numeric;
  v_tipos_dev text[];
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

  WITH atual AS (
    SELECT m.vendedor cod, sum(m.valor) fat, sum(m.kg) vol,
           count(DISTINCT m.cliente_cod) cli, count(DISTINCT m.cidade) cid,
           sum(m.valor_tabela) vtab
    FROM public.bi_comercial_venda_item_mv m
    WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini AND p_dt_fim
      -- CEO 12/11: exclui quem o gestor desmarcou do ranking (ex. diretor/sócio que vende). Ausência de linha = incluído.
      AND NOT EXISTS (
        SELECT 1 FROM public.com_ranking_participante rp
         WHERE rp.company_id = p_company_id AND rp.cod_vendedor = m.vendedor AND rp.incluido = false)
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
  piso AS ( SELECT COALESCE(max(vol), 0) * 0.05 pk FROM base ),
  flagged AS ( SELECT base.*, (vol < (SELECT pk FROM piso)) abaixo_min FROM base ),
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
      -- disciplina de preço: MENOR desconto_pct é melhor (acréscimo = desconto_pct negativo = nota 100).
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
          -- acréscimo = vendeu acima da tabela (desconto_pct negativo). Positivo e verde na tela (Entrega 1).
          'acrescimo_pct', CASE WHEN desconto_pct < 0 THEN round(-desconto_pct, 1) ELSE NULL END,
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

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 5) Ajuda de campo (RD-95) — seção Participantes e nota de acréscimo.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
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
   'comercial', 54, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.rota = v.rota AND e.chave = v.chave);
