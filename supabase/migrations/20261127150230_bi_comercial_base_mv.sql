-- =====================================================================
-- perf(comercial/bi): fn_bi_comercial_base lê as MVs (bi_comercial_venda_item_mv + nova bi_comercial_devolucao_mv)
-- em vez do raw de ind_atak_fato. CEO 25/11. Mesmos números (o jsonb de retorno é idêntico — só troca a FONTE
-- dos blocos `raw` (extras de venda) e `dev` (devoluções)). Não mexe em dado de cliente.
--
-- A venda MV ganha 4 colunas que o bloco `raw` lia do raw (nome do vendedor, CPF do cliente, prazo médio, condição).
-- As devoluções ganham uma MV própria (não existia). A refresh de 30 min passa a atualizar as duas.
-- =====================================================================
SET LOCAL statement_timeout = '15min';
SET LOCAL lock_timeout = '60s';

-- 1) Venda MV — recriada com as 4 colunas extras ao final (consumidores usam colunas explícitas; sem deps de view).
DROP MATERIALIZED VIEW IF EXISTS public.bi_comercial_venda_item_mv;
CREATE MATERIALIZED VIEW public.bi_comercial_venda_item_mv AS
 SELECT company_id,
    chave_fato AS fato_id,
    'atak'::text AS origem,
    "left"(raw ->> 'DATA_MOVTO'::text, 10)::date AS dia,
    raw ->> 'CHAVE_FATO'::text AS nota,
    COALESCE(NULLIF(TRIM(BOTH FROM raw ->> 'COD_VEND_COMP'::text), ''::text), 's/v'::text) AS vendedor,
    TRIM(BOTH FROM raw ->> 'COD_CLI_FOR'::text) AS cliente_cod,
    "left"(TRIM(BOTH FROM raw ->> 'NOME_CADASTRO'::text), 40) AS cliente,
    (initcap(TRIM(BOTH FROM raw ->> 'CIDADE'::text)) || '/'::text) || TRIM(BOTH FROM raw ->> 'UF'::text) AS cidade,
    TRIM(BOTH FROM raw ->> 'COD_PRODUTO'::text) AS produto_cod,
    "left"(TRIM(BOTH FROM raw ->> 'DESC_PRODUTO_NF'::text), 40) AS produto,
    split_part(raw ->> 'DESC_DIVISAO'::text, ' - '::text, 1) AS linha,
    "left"(raw ->> 'DESC_DIVISAO'::text, 5) = 'CARNE'::text OR "left"(raw ->> 'DESC_DIVISAO'::text, 6) = 'MIUDOS'::text AS carne,
    CASE
        WHEN TRIM(BOTH FROM raw ->> 'COD_UNIDADE_PRI'::text) = 'KG'::text THEN (raw ->> 'QTDE_PRI'::text)::numeric
        ELSE 0::numeric
    END AS kg,
    (raw ->> 'VALOR_LIQUIDO_ITEM'::text)::numeric AS valor,
    CASE
        WHEN ((raw ->> 'VALOR_UNITARIO_LISTA'::text)::numeric) > 0::numeric THEN ((raw ->> 'VALOR_UNITARIO_LISTA'::text)::numeric) * ((raw ->> 'QTDE_UND'::text)::numeric)
        ELSE (raw ->> 'VALOR_LIQUIDO_ITEM'::text)::numeric
    END AS valor_tabela,
    ((raw ->> 'VALOR_UNITARIO'::text)::numeric) < ((raw ->> 'VALOR_UNITARIO_LISTA'::text)::numeric) AS abaixo_tabela,
    NULLIF(TRIM(BOTH FROM raw ->> 'NUM_CARGA'::text), ''::text) AS carga,
    COALESCE(NULLIF(TRIM(BOTH FROM raw ->> 'NOME_TRANSPORTADOR'::text), ''::text), 'Sem transportador'::text) AS transportador,
    -- NOVAS (eram lidas do raw no bloco `raw` da fn_bi_comercial_base) — mesmas expressões
    TRIM(BOTH FROM raw ->> 'NOME_COMP'::text) AS vendedor_nome,
    regexp_replace(COALESCE(raw ->> 'CPF_CGC'::text, ''::text), '\D'::text, ''::text, 'g'::text) AS cliente_cpf,
    NULLIF(TRIM(BOTH FROM raw ->> 'PRAZO_MEDIO'::text), ''::text)::numeric AS prazo_medio,
    NULLIF(TRIM(BOTH FROM raw ->> 'DESC_COND_PGTO'::text), ''::text) AS cond_pgto
   FROM ind_atak_fato f
  WHERE dominio = 'comercial_venda_item'::text AND TRIM(BOTH FROM raw ->> 'STATUS'::text) <> 'C'::text AND TRIM(BOTH FROM raw ->> 'COD_PRODUTO'::text) <> '10'::text
  WITH DATA;
CREATE UNIQUE INDEX ux_bi_comercial_venda_item_mv ON public.bi_comercial_venda_item_mv USING btree (company_id, fato_id);
CREATE INDEX ix_bi_comercial_venda_item_mv_dia ON public.bi_comercial_venda_item_mv USING btree (company_id, dia);

-- 2) Devolução MV — nova (o bloco `dev` da base lia o raw de 'comercial_devolucao'). Mesmas expressões.
DROP MATERIALIZED VIEW IF EXISTS public.bi_comercial_devolucao_mv;
CREATE MATERIALIZED VIEW public.bi_comercial_devolucao_mv AS
  SELECT f.company_id,
         f.chave_fato,
         "left"(f.raw ->> 'DATA_MOVTO'::text, 10)::date AS dia,
         COALESCE(NULLIF(TRIM(BOTH FROM f.raw ->> 'COD_VEND_COMP'::text), ''::text), 's/v'::text) AS vendedor,
         TRIM(BOTH FROM f.raw ->> 'COD_CLI_FOR'::text) AS cliente_cod,
         "left"(TRIM(BOTH FROM f.raw ->> 'NOME_CADASTRO'::text), 40) AS cliente,
         TRIM(BOTH FROM f.raw ->> 'COD_PRODUTO'::text) AS produto_cod,
         "left"(TRIM(BOTH FROM f.raw ->> 'DESC_PRODUTO_NF'::text), 40) AS produto,
         TRIM(BOTH FROM f.raw ->> 'NUM_DOCTO'::text) AS documento,
         CASE WHEN TRIM(BOTH FROM f.raw ->> 'COD_UNIDADE_PRI'::text) = 'KG'::text
              THEN COALESCE((f.raw ->> 'QTDE_PRI'::text)::numeric, 0::numeric) ELSE 0::numeric END AS kg,
         COALESCE((f.raw ->> 'VALOR_LIQUIDO_ITEM'::text)::numeric, 0::numeric) AS valor
    FROM ind_atak_fato f
   WHERE f.dominio = 'comercial_devolucao'::text AND TRIM(BOTH FROM f.raw ->> 'STATUS'::text) <> 'C'::text
  WITH DATA;
CREATE INDEX ix_bi_comercial_devolucao_mv_dia ON public.bi_comercial_devolucao_mv USING btree (company_id, dia);

-- 3) Refresh de 30 min passa a atualizar também a devolução (plain, pois a MV de devolução não tem chave única).
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_item_refresh()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.bi_comercial_item_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.bi_comercial_venda_item_mv;
  REFRESH MATERIALIZED VIEW public.bi_comercial_devolucao_mv;
  INSERT INTO public.bi_comercial_item_status (company_id, atualizado_em)
  SELECT DISTINCT company_id, now() FROM public.bi_comercial_item_mv
  ON CONFLICT (company_id) DO UPDATE SET atualizado_em = EXCLUDED.atualizado_em;
  RETURN jsonb_build_object('ok', true, 'em', now());
END
$function$;
REVOKE ALL ON FUNCTION public.fn_bi_comercial_item_refresh() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_item_refresh() TO service_role;

-- 4) Último refresh por empresa (para a tela mostrar "dados atualizados às HH:MM").
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_atualizado_em(p_company_id uuid)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.atualizado_em FROM public.bi_comercial_item_status s
   WHERE s.company_id = p_company_id
     AND (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
$function$;
REVOKE ALL ON FUNCTION public.fn_bi_comercial_atualizado_em(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_atualizado_em(uuid) TO authenticated, service_role;

-- 5) fn_bi_comercial_base — MESMO retorno; só os blocos `raw` (extras de venda) e `dev` (devoluções) passam a ler as MVs.
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_base(p_company_id uuid, p_de date DEFAULT NULL::date, p_ate date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_scope jsonb;
  v_modo  text;
  v_cod   text;
  v_cods  text[];
  v_ate   date := COALESCE(p_ate, current_date);
  v_de    date := COALESCE(p_de, v_ate - 30);
  v_out   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'login_obrigatorio';
  END IF;
  IF v_ate < v_de THEN
    RAISE EXCEPTION 'periodo_invalido';
  END IF;

  -- Guarda de escopo (a mesma do BI comercial). Fail-closed: 'sem_acesso' não devolve nada.
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  v_modo  := v_scope->>'modo';
  v_cod   := v_scope->>'cod';
  v_cods  := ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_scope->'cods', '[]'::jsonb)));
  IF v_modo IS NULL OR v_modo = 'sem_acesso' THEN
    RAISE EXCEPTION 'sem_acesso_comercial';
  END IF;

  WITH
  -- Espinho de venda (reuso), já filtrado por escopo.
  v AS (
    SELECT i.dia, i.nota, i.vendedor, i.cliente_cod, i.cliente, i.cidade,
           i.produto_cod, i.produto, i.linha, i.carne,
           i.kg, i.valor, i.valor_tabela, i.carga, i.transportador
    FROM public.fn_com_venda_item(p_company_id, v_de, v_ate) i
    WHERE (v_modo = 'lider' OR i.vendedor = ANY(v_cods))
  ),
  -- Campos extras por chave — agora da MV de venda (mesmas expressões/filtros que o raw tinha: STATUS<>'C', COD_PRODUTO<>'10').
  raw AS (
    SELECT m.vendedor                                 AS ven,
           m.vendedor_nome                            AS vnome,
           m.cliente_cod                              AS cli,
           m.cliente_cpf                              AS cpf,
           trim(m.nota)                               AS chave,
           m.prazo_medio                              AS prazo,
           m.cond_pgto                                AS cond
    FROM public.bi_comercial_venda_item_mv m
    WHERE m.company_id = p_company_id
      AND m.dia >= v_de AND m.dia <= v_ate
      AND (v_modo = 'lider' OR m.vendedor = ANY(v_cods))
  ),
  ven_nome AS (SELECT ven AS cod, max(vnome) AS nome FROM raw GROUP BY ven),
  cli_cpf  AS (SELECT cli AS cod, max(cpf)   AS cpf  FROM raw WHERE cli IS NOT NULL GROUP BY cli),
  nota_ext AS (SELECT chave, max(prazo) AS prazo, max(cond) AS cond FROM raw GROUP BY chave),
  -- Devoluções (mesmo escopo) — agora da MV própria (mesmas expressões/filtro STATUS<>'C' que o raw tinha).
  dev AS (
    SELECT d.dia, d.vendedor, d.cliente_cod, d.cliente, d.produto_cod, d.produto, d.documento, d.kg, d.valor
    FROM public.bi_comercial_devolucao_mv d
    WHERE d.company_id = p_company_id
      AND d.dia >= v_de AND d.dia <= v_ate
      AND (v_modo = 'lider' OR d.vendedor = ANY(v_cods))
  ),
  -- Dimensão VENDEDOR (venda ∪ devolução), índice estável por código.
  ven_d AS (
    SELECT cod, (row_number() OVER (ORDER BY cod)) - 1 AS idx
    FROM (SELECT DISTINCT vendedor AS cod FROM v
          UNION SELECT DISTINCT vendedor FROM dev) s
  ),
  -- Dimensão CIDADE (só venda tem cidade). Índice estável por nome.
  cid_d AS (
    SELECT cidade, (row_number() OVER (ORDER BY cidade)) - 1 AS idx
    FROM (SELECT DISTINCT cidade FROM v WHERE cidade IS NOT NULL) s
  ),
  -- Dimensão TRANSPORTADOR (só venda).
  tr_d AS (
    SELECT transportador, (row_number() OVER (ORDER BY transportador)) - 1 AS idx
    FROM (SELECT DISTINCT transportador FROM v WHERE transportador IS NOT NULL) s
  ),
  -- Dimensão PRODUTO (venda), guardando linha e se é carne/miúdo.
  prod_d AS (
    SELECT produto_cod,
           max(produto) AS nome,
           max(linha)   AS linha,
           bool_or(carne) AS carne,
           (row_number() OVER (ORDER BY produto_cod)) - 1 AS idx
    FROM v WHERE produto_cod IS NOT NULL
    GROUP BY produto_cod
  ),
  -- Dimensão NOTA (venda), com prazo médio e condição.
  nota_d AS (
    SELECT n.chave,
           x.prazo, x.cond,
           (row_number() OVER (ORDER BY n.chave)) - 1 AS idx
    FROM (SELECT DISTINCT nota AS chave FROM v WHERE nota IS NOT NULL) n
    LEFT JOIN nota_ext x ON x.chave = n.chave
  ),
  -- Faturamento por cliente (p/ nome do grupo = maior loja) e raiz de CNPJ.
  cli_base AS (
    SELECT c.cod,
           c.nome,
           c.cidade,
           cc.cpf,
           CASE WHEN cc.cpf IS NOT NULL AND length(cc.cpf) = 14 THEN left(cc.cpf, 8) END AS raiz,
           c.val
    FROM (
      SELECT cliente_cod AS cod,
             max(cliente)  AS nome,
             max(cidade)   AS cidade,
             sum(valor)    AS val
      FROM v WHERE cliente_cod IS NOT NULL
      GROUP BY cliente_cod
      UNION ALL
      SELECT d.cliente_cod, max(d.cliente), NULL::text, 0
      FROM dev d
      WHERE d.cliente_cod IS NOT NULL
        AND d.cliente_cod NOT IN (SELECT cliente_cod FROM v WHERE cliente_cod IS NOT NULL)
      GROUP BY d.cliente_cod
    ) c
    LEFT JOIN cli_cpf cc ON cc.cod = c.cod
  ),
  grp_raiz AS (
    SELECT raiz FROM cli_base WHERE raiz IS NOT NULL GROUP BY raiz HAVING count(DISTINCT cod) >= 2
  ),
  grp_nome AS (
    SELECT DISTINCT ON (cb.raiz) cb.raiz, cb.nome
    FROM cli_base cb JOIN grp_raiz g ON g.raiz = cb.raiz
    ORDER BY cb.raiz, cb.val DESC, cb.cod
  ),
  grp_d AS (
    SELECT raiz, nome, (row_number() OVER (ORDER BY nome, raiz)) - 1 AS idx FROM grp_nome
  ),
  cli_d AS (
    SELECT cb.cod,
           cb.nome,
           COALESCE(cd.idx, -1) AS cid_idx,
           COALESCE(gd.idx, -1) AS grp_idx,
           (row_number() OVER (ORDER BY cb.cod)) - 1 AS idx
    FROM cli_base cb
    LEFT JOIN cid_d cd ON cd.cidade = cb.cidade
    LEFT JOIN grp_d gd ON gd.raiz = cb.raiz
  ),
  carga_d AS (
    SELECT carga, (row_number() OVER (ORDER BY carga)) - 1 AS idx
    FROM (SELECT DISTINCT carga FROM v WHERE carga IS NOT NULL) s
  )
  SELECT jsonb_build_object(
    'modo', v_modo,
    'de',   to_char(v_de, 'YYYY-MM-DD'),
    'ate',  to_char(v_ate, 'YYYY-MM-DD'),
    'ven',  COALESCE((SELECT jsonb_agg(jsonb_build_array(
                               d.cod,
                               COALESCE(vn.nome, d.cod),
                               CASE WHEN rp.incluido IS FALSE THEN 0 ELSE 1 END
                             ) ORDER BY d.idx)
                      FROM ven_d d
                      LEFT JOIN ven_nome vn ON vn.cod = d.cod
                      LEFT JOIN public.com_ranking_participante rp
                             ON rp.company_id = p_company_id AND rp.cod_vendedor = d.cod), '[]'::jsonb),
    'cid',  COALESCE((SELECT jsonb_agg(d.cidade ORDER BY d.idx) FROM cid_d d), '[]'::jsonb),
    'tr',   COALESCE((SELECT jsonb_agg(d.transportador ORDER BY d.idx) FROM tr_d d), '[]'::jsonb),
    'grp',  COALESCE((SELECT jsonb_agg(d.nome ORDER BY d.idx) FROM grp_d d), '[]'::jsonb),
    'prod', COALESCE((SELECT jsonb_agg(jsonb_build_array(d.nome, d.linha, CASE WHEN d.carne THEN 1 ELSE 0 END) ORDER BY d.idx)
                      FROM prod_d d), '[]'::jsonb),
    'notas',COALESCE((SELECT jsonb_agg(jsonb_build_array(d.prazo, d.cond) ORDER BY d.idx) FROM nota_d d), '[]'::jsonb),
    'cli',  COALESCE((SELECT jsonb_agg(jsonb_build_array(d.nome, d.cid_idx, d.grp_idx) ORDER BY d.idx) FROM cli_d d), '[]'::jsonb),
    'items',COALESCE((
      SELECT jsonb_agg(jsonb_build_array(
               (v.dia - v_de)::int,
               nd.idx, vd.idx, cd.idx, pd.idx,
               round(v.kg, 3), round(v.valor, 2), round(v.valor_tabela, 2),
               COALESCE(gd.idx, -1),
               td.idx
             ))
      FROM v
      JOIN ven_d  vd ON vd.cod = v.vendedor
      JOIN cli_d  cd ON cd.cod = v.cliente_cod
      JOIN prod_d pd ON pd.produto_cod = v.produto_cod
      JOIN nota_d nd ON nd.chave = v.nota
      LEFT JOIN carga_d gd ON gd.carga = v.carga
      LEFT JOIN tr_d    td ON td.transportador = v.transportador
    ), '[]'::jsonb),
    'dev',  COALESCE((
      SELECT jsonb_agg(jsonb_build_array(
               (d.dia - v_de)::int,
               vd.idx, cd.idx, COALESCE(pd.idx, -1),
               round(d.valor, 2), round(d.kg, 3),
               d.documento, d.produto
             ))
      FROM dev d
      JOIN ven_d  vd ON vd.cod = d.vendedor
      JOIN cli_d  cd ON cd.cod = d.cliente_cod
      LEFT JOIN prod_d pd ON pd.produto_cod = d.produto_cod
    ), '[]'::jsonb)
  )
  INTO v_out;

  RETURN v_out;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_bi_comercial_base(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_base(uuid, date, date) TO authenticated, service_role;

-- 6) Ajuda do indicador "dados atualizados às HH:MM" (RD-95).
INSERT INTO erp_ajuda_campo (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, status, versao)
VALUES ('com.painel.atualizado', '/dashboard/comercial/meu-painel', 'BI comercial', 'comercial', 'Dados atualizados às',
  'Mostra o horário da última atualização dos dados do painel. Não é um campo — é a hora do último processamento.',
  'O painel lê uma base pré-calculada que é atualizada automaticamente a cada 30 minutos, para abrir rápido. Por isso uma venda dos últimos minutos pode ainda não aparecer.',
  'Dados atualizados às 14:30 — a próxima atualização é por volta das 15:00.',
  'Se um lançamento muito recente não aparece, aguarde a próxima atualização (até 30 min).', 'publicado', 1)
ON CONFLICT (chave) DO UPDATE SET rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, vertical = EXCLUDED.vertical,
  rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, status = 'publicado', versao = erp_ajuda_campo.versao + 1, atualizado_em = now();
