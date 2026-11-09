-- Painel comercial v5 (CEO 07/11) · ITEM 1 — RPC de leitura do pacote de dados (__BASE__)
-- Tarefa dev7claudeps. Fonte do pacote: docs/prototipos/bi-comercial-v5/formato-dados.md.
--
-- O QUE FAZ: fn_bi_comercial_base(empresa, de, ate) devolve, em UMA chamada, o pacote __BASE__ que
-- o logica.js do protótipo v5 consome (items + dicionários cli/grp/prod/cid/tr/ven/notas + devoluções).
-- É SÓ LEITURA, ADITIVA (função NOVA, nenhuma recriada) e usa a MESMA guarda de escopo do BI comercial
-- (public.fn_bi_comercial_scope): FAIL-CLOSED — sem acesso levanta exceção; vendedor recebe só as linhas dele;
-- diretoria/admin recebem a empresa toda. Nenhum campo de custo/margem/preço de custo sai no pacote.
--
-- REUSO (RD-26): o ESPINHO de itens (valor, kg, cliente, produto, cidade, carga, transportador, nota) vem de
-- public.fn_com_venda_item — a mesma função que o painel atual usa, cujos totais já estão provados (Frioeste
-- 01/10–06/11: R$ 13.983.740 · 6.285 itens · 482 clientes · 127 produtos). Os campos que a fn_com_venda_item
-- NÃO expõe e que o pacote exige (nome do vendedor = NOME_COMP, raiz do CNPJ = CPF_CGC p/ grupo econômico,
-- PRAZO_MEDIO e DESC_COND_PGTO por nota) vêm de public.ind_atak_fato (domínio comercial_venda_item), lidos
-- em agregados pequenos por chave — exatamente o "+ ind_atak_fato" do formato-dados.md. As devoluções vêm do
-- domínio comercial_devolucao. Tudo com janela/empresa/domínio fixos (sem varredura ampla, sem função por
-- linha em volume — incidente 03/10 respeitado).
--
-- SEGURANÇA: SECURITY DEFINER + search_path fixo; exige usuário logado e empresa do usuário (via a guarda);
-- REVOKE de PUBLIC/anon; GRANT só a authenticated e service_role. Não cria/altera tabela, não toca RLS/grants
-- de terceiros, não altera dado de cliente. RD-100: nenhum nome de sistema de terceiros no código/saída.

CREATE OR REPLACE FUNCTION public.fn_bi_comercial_base(
  p_company_id uuid,
  p_de date DEFAULT NULL,
  p_ate date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_scope jsonb;
  v_modo  text;
  v_cod   text;
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
  IF v_modo IS NULL OR v_modo = 'sem_acesso' THEN
    RAISE EXCEPTION 'sem_acesso_comercial';
  END IF;
  -- v_modo ∈ ('lider','vendedor'); 'vendedor' => só o próprio código.

  WITH
  -- Espinho de venda (reuso), já filtrado por escopo.
  v AS (
    SELECT i.dia, i.nota, i.vendedor, i.cliente_cod, i.cliente, i.cidade,
           i.produto_cod, i.produto, i.linha, i.carne,
           i.kg, i.valor, i.valor_tabela, i.carga, i.transportador
    FROM public.fn_com_venda_item(p_company_id, v_de, v_ate) i
    WHERE (v_modo = 'lider' OR i.vendedor = v_cod)
  ),
  -- Campos extras por chave, do raw de venda (mesmos filtros da fn_com_venda_item).
  raw AS (
    SELECT COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'), ''), 's/v') AS ven,
           trim(f.raw->>'NOME_COMP')                                   AS vnome,
           trim(f.raw->>'COD_CLI_FOR')                                 AS cli,
           regexp_replace(COALESCE(f.raw->>'CPF_CGC',''), '\D', '', 'g') AS cpf,
           trim(f.raw->>'CHAVE_FATO')                                  AS chave,
           NULLIF(trim(f.raw->>'PRAZO_MEDIO'), '')::numeric            AS prazo,
           NULLIF(trim(f.raw->>'DESC_COND_PGTO'), '')                  AS cond
    FROM public.ind_atak_fato f
    WHERE f.company_id = p_company_id AND f.dominio = 'comercial_venda_item'
      AND trim(f.raw->>'STATUS') <> 'C'
      AND trim(f.raw->>'COD_PRODUTO') <> '10'
      AND left(f.raw->>'DATA_MOVTO', 10) >= to_char(v_de, 'YYYY-MM-DD')
      AND left(f.raw->>'DATA_MOVTO', 10) <= to_char(v_ate, 'YYYY-MM-DD')
      AND (v_modo = 'lider' OR COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'), ''), 's/v') = v_cod)
  ),
  ven_nome AS (SELECT ven AS cod, max(vnome) AS nome FROM raw GROUP BY ven),
  cli_cpf  AS (SELECT cli AS cod, max(cpf)   AS cpf  FROM raw WHERE cli IS NOT NULL GROUP BY cli),
  nota_ext AS (SELECT chave, max(prazo) AS prazo, max(cond) AS cond FROM raw GROUP BY chave),
  -- Devoluções (mesmo escopo), do domínio próprio.
  dev AS (
    SELECT left(f.raw->>'DATA_MOVTO', 10)::date                         AS dia,
           COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'), ''), 's/v')   AS vendedor,
           trim(f.raw->>'COD_CLI_FOR')                                  AS cliente_cod,
           left(trim(f.raw->>'NOME_CADASTRO'), 40)                      AS cliente,
           trim(f.raw->>'COD_PRODUTO')                                  AS produto_cod,
           left(trim(f.raw->>'DESC_PRODUTO_NF'), 40)                    AS produto,
           trim(f.raw->>'NUM_DOCTO')                                    AS documento,
           CASE WHEN trim(f.raw->>'COD_UNIDADE_PRI') = 'KG'
                THEN COALESCE((f.raw->>'QTDE_PRI')::numeric, 0) ELSE 0 END AS kg,
           COALESCE((f.raw->>'VALOR_LIQUIDO_ITEM')::numeric, 0)         AS valor
    FROM public.ind_atak_fato f
    WHERE f.company_id = p_company_id AND f.dominio = 'comercial_devolucao'
      AND trim(f.raw->>'STATUS') <> 'C'
      AND left(f.raw->>'DATA_MOVTO', 10) >= to_char(v_de, 'YYYY-MM-DD')
      AND left(f.raw->>'DATA_MOVTO', 10) <= to_char(v_ate, 'YYYY-MM-DD')
      AND (v_modo = 'lider' OR COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'), ''), 's/v') = v_cod)
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
      -- clientes que só aparecem em devolução (sem venda) entram com nome e sem cidade/valor
      SELECT d.cliente_cod, max(d.cliente), NULL::text, 0
      FROM dev d
      WHERE d.cliente_cod IS NOT NULL
        AND d.cliente_cod NOT IN (SELECT cliente_cod FROM v WHERE cliente_cod IS NOT NULL)
      GROUP BY d.cliente_cod
    ) c
    LEFT JOIN cli_cpf cc ON cc.cod = c.cod
  ),
  -- Grupos econômicos: raiz de CNPJ com 2+ lojas. Nome = maior loja (por faturamento).
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
  -- Dimensão CLIENTE final: [nome, cidadeIdx, grupoIdx].
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
  -- Dimensão CARGA: id denso por número de carga (venda). -1 quando sem carga.
  carga_d AS (
    SELECT carga, (row_number() OVER (ORDER BY carga)) - 1 AS idx
    FROM (SELECT DISTINCT carga FROM v WHERE carga IS NOT NULL) s
  )
  SELECT jsonb_build_object(
    'modo', v_modo,
    'de',   to_char(v_de, 'YYYY-MM-DD'),
    'ate',  to_char(v_ate, 'YYYY-MM-DD'),
    'ven',  COALESCE((SELECT jsonb_agg(jsonb_build_array(d.cod, COALESCE(vn.nome, d.cod)) ORDER BY d.idx)
                      FROM ven_d d LEFT JOIN ven_nome vn ON vn.cod = d.cod), '[]'::jsonb),
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

COMMENT ON FUNCTION public.fn_bi_comercial_base(uuid, date, date) IS
  'Painel comercial v5: pacote de dados __BASE__ (itens + dicionários + devoluções) para /dashboard/comercial/meu-painel. Leitura, escopo via fn_bi_comercial_scope (fail-closed); vendedor vê só as próprias linhas; sem custo/margem.';
