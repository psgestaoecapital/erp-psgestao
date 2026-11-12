-- Ranking de vendedores — filtro "quem entra no ranking" + exclusão na pontuação (CEO 12/11, contexto a059298b).
-- Problema real auditado na Frioeste: diretor/sócio que também vende (ex. Franciele) aparecia no pódio e na tabela
-- de pontuação dos vendedores. O CEO pediu que o gestor marque/desmarque manualmente quem entra no ranking;
-- quem for desmarcado SAI do pódio e da tabela de pontuação, mas CONTINUA no BI comercial normal.
--
-- DEPENDÊNCIA DE ORDEM (revisor gilberto-revisor em #4814): esta migration REESCREVE a MESMA função
-- fn_bi_comercial_ranking_pontuacao que a #4813 (20261114130030). O corpo abaixo PARTE do corpo FINAL da #4813
-- (base CARNE, exclui 's/v', índice de preço por mix, positivação de novos, fn_norm_0_100 travado em [0,100],
-- nota NULL abaixo do piso) e adiciona POR CIMA apenas (1) o filtro de participante e (2) o campo acrescimo_pct.
-- Por isso esta PR deve ser publicada DEPOIS da #4813 (a #4813 também ajusta a fn_norm_0_100 para [0,100], da
-- qual este cálculo depende). Se publicada antes, a #4813 sobrescreve estas 2 adições — por isso a ordem.
--
-- Observação de disciplina de preço (Entrega 1 — acréscimo): a nota de desconto JÁ premia acréscimo. O indicador
-- desconto_pct = (tabela − praticado)/tabela; vender ACIMA da tabela → desconto_pct negativo → mínimo da régua →
-- fn_norm_0_100(..., higher=false) devolve 100. Ou seja, acréscimo recebe a MELHOR nota e desconto real a pior
-- (correto). O sinal invertido era só de EXIBIÇÃO (tratado na tela). Aqui não se mexe na normalização.
--
-- SÓ LEITURA do BI; aditiva: 1 tabela nova (RLS por empresa, REVOKE anon, escrita só via RPC de líder) + 2 RPCs
-- novas + CREATE OR REPLACE da fn de pontuação. Guarda 'lider' (fn_bi_comercial_scope) + fn__guarda_empresa.

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
  -- Defesa em profundidade + gate de guarda (check-fn-guards regra 4): confere o acesso à empresa antes de gravar.
  -- Redundante com a guarda 'lider' acima (líder é sempre da própria empresa), mas garante fail-closed explícito.
  PERFORM public.fn__guarda_empresa(p_company_id);
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
-- 4) Pontuação do ranking — PARTE DO CORPO FINAL DA #4813 (20261114130030) e adiciona 2 coisas:
--      (A) filtro de participante: exclui quem o gestor desmarcou (incluido=false) já no CTE `atual`;
--      (B) acrescimo_pct no bloco de indicadores (exibição; a nota já premia acréscimo).
--    NÃO reescreve fn_norm_0_100 (isso é da #4813) — ver "DEPENDÊNCIA DE ORDEM" no topo.
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
  v_scope jsonb; v_out jsonb; v_pc numeric; v_pm numeric; v_tipos_dev text[];
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

  -- Tipos de devolução configurados (migration 20261114121045); rede de segurança T582/T583 se não houver.
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
  -- Preço médio da empresa por produto, na base CARNE do período atual (para o índice ajustado pelo mix).
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
      -- (A) CEO 12/11 (#4814): exclui quem o gestor desmarcou do ranking. Ausência de linha = incluído.
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
      CASE WHEN a.exp_val > 0 THEN a.fat / a.exp_val * 100 END indice_preco,       -- 100 = no preço médio da empresa p/ o mix dele
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
  -- Crescimento entra na régua limitado a [0,100]% (queda e estabilidade = 0; evita base pequena distorcer).
  capped AS (
    SELECT base.*,
      least(100, greatest(0, cresc_fat)) cfc,
      least(100, greatest(0, cresc_vol)) cvc
    FROM base
  ),
  piso AS ( SELECT COALESCE(max(vol), 0) * 0.05 pk FROM capped ),  -- 5% do volume (carne) do líder
  flagged AS ( SELECT capped.*, (vol < (SELECT pk FROM piso)) abaixo_min FROM capped ),
  -- réguas só entre quem está ACIMA do piso (não distorcer a normalização).
  mm AS (
    SELECT min(cli) cli_mn, max(cli) cli_mx, min(cli_novos) cn_mn, max(cli_novos) cn_mx,
           min(cid) cid_mn, max(cid) cid_mx, min(cid_novos) dn_mn, max(cid_novos) dn_mx,
           min(indice_preco) ip_mn, max(indice_preco) ip_mx, min(desconto_pct) ds_mn, max(desconto_pct) ds_mx,
           min(dev_pct) dv_mn, max(dev_pct) dv_mx, min(cfc) cf_mn, max(cfc) cf_mx, min(cvc) cv_mn, max(cvc) cv_mx
    FROM flagged WHERE NOT abaixo_min
  ),
  calc AS (
    SELECT g.*,
      public.fn_norm_0_100(g.cli, m.cli_mn, m.cli_mx, true)                 s_cli_a,
      public.fn_norm_0_100(g.cli_novos, m.cn_mn, m.cn_mx, true)             s_cli_n,
      public.fn_norm_0_100(g.cid, m.cid_mn, m.cid_mx, true)                 s_cid_a,
      public.fn_norm_0_100(g.cid_novos, m.dn_mn, m.dn_mx, true)             s_cid_n,
      public.fn_norm_0_100(g.indice_preco, m.ip_mn, m.ip_mx, true)          s_preco,
      public.fn_norm_0_100(g.desconto_pct, m.ds_mn, m.ds_mx, false)         s_desc,
      public.fn_norm_0_100(g.dev_pct, m.dv_mn, m.dv_mx, false)              s_dev,
      public.fn_norm_0_100(g.cfc, m.cf_mn, m.cf_mx, true)                   s_cf,
      public.fn_norm_0_100(g.cvc, m.cv_mn, m.cv_mx, true)                   s_cv
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
      round(0.50 * n.s_cf + 0.25 * n.s_cv + 0.25 * ((n.s_cli + n.s_cid) / 2.0), 1) bloco_crescimento,
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
          -- (B) #4814: acréscimo = vendeu acima da tabela (desconto_pct negativo). Positivo e verde na tela (Entrega 1).
          'acrescimo_pct', CASE WHEN desconto_pct < 0 THEN round(-desconto_pct, 1) ELSE NULL END,
          'devolucao_pct', round(dev_pct, 1), 'crescimento_fat_pct', round(cresc_fat, 1),
          'crescimento_vol_pct', round(cresc_vol, 1)),
        'notas', jsonb_build_object(
          'crescimento_fat', s_cf, 'crescimento_vol', s_cv, 'clientes', s_cli, 'cidades', s_cid,
          'preco', s_preco, 'desconto', s_desc, 'devolucao', s_dev),
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
   'comercial', 55, 'publicado'),
  ('comercial.ranking.acrescimo', '/dashboard/comercial/meu-painel', 'Ranking', 'Acréscimo / desconto',
   'Nada a preencher. Mostra se o vendedor vendeu abaixo (desconto) ou ACIMA (acréscimo) da tabela de preços.',
   'Na nota de disciplina de preço, vender acima da tabela conta A FAVOR (acréscimo é bom) e desconto real conta contra. Quem pratica acréscimo recebe a melhor nota desse indicador.',
   'Vendedor com Costela +13,5% sobre a tabela aparece como "Acréscimo 13,5%" (verde) e ganha nota alta de preço.',
   'Ler acréscimo como se fosse desconto negativo ruim: acréscimo é positivo para a margem.',
   'comercial', 56, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.rota = v.rota AND e.chave = v.chave);
