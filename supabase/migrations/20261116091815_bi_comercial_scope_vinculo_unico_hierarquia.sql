-- Escopo do painel de vendas v7: fonte ÚNICA do vínculo usuário↔vendedor + hierarquia (CEO/Eng.Chefe 12/11, tarefa ef00dac6)
--
-- PROBLEMA (RD-71): a tela Administração › Vendedores grava o vínculo em com_vendedor_acesso
-- (fn_com_vendedor_acesso_salvar), mas fn_bi_comercial_scope lia OUTRA tabela (bi_comercial_vendedor).
-- Ligar um vendedor na tela NÃO tinha efeito no painel v7. Agora o scope usa com_vendedor_acesso como
-- fonte única e expande a hierarquia (fn_com_equipe, domínio comercial_hierarquia do ERP de origem):
--   • Gerente/Diretor (ou líder por papel: admin/dono/gerente da conta/diretor_vendas) → vê a empresa toda ('lider');
--   • Supervisor → vê o próprio código + toda a equipe abaixo (recursivo);
--   • Vendedor → vê só o próprio código;
--   • papel comercial SEM vínculo → FAIL-CLOSED ('sem_acesso', nunca a empresa inteira).
-- RD-30: bi_comercial_vendedor NÃO é apagada; o que houver nela é migrado para com_vendedor_acesso.
-- Backward-compat: o scope continua devolvendo {modo, cod}; acrescenta {cods} (próprio + equipe) que só o
-- fn_bi_comercial_base consome. Os demais consumidores (kpis/pareto/serie/ranking/analise/metas) seguem
-- lendo {modo, cod} e passam a respeitar o vínculo da tela (mais restritivo = seguro).
-- Aditiva: nenhum dado de cliente é alterado. RD-38: provas de hierarquia/contagem no corpo da PR.

-- 1) Migra o vínculo da tabela antiga para a canônica (idempotente; RD-30 mantém a tabela antiga).
INSERT INTO public.com_vendedor_acesso (company_id, user_id, codigo, ativo, criado_em)
SELECT b.company_id, b.user_id, b.cod_vend_comp, true, COALESCE(b.criado_em, now())
FROM public.bi_comercial_vendedor b
WHERE b.user_id IS NOT NULL AND NULLIF(trim(b.cod_vend_comp),'') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.com_vendedor_acesso a
    WHERE a.company_id = b.company_id AND a.user_id = b.user_id
  );

-- 2) Scope: fonte única + hierarquia + fail-closed.
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_scope(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_cod   text;
  v_cargo text;
  v_lider boolean;
  v_cods  text[];
BEGIN
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('modo', 'sem_acesso');
  END IF;

  -- Líder por PAPEL de acesso: admin, dono/gerente da conta, diretor/assistente de vendas → empresa toda.
  v_lider := public.is_admin() OR EXISTS (
    SELECT 1 FROM tenant_user_roles r
     WHERE r.user_id = v_uid AND r.company_id = p_company_id AND COALESCE(r.is_active, true)
       AND (r.role IN ('CLIENT_OWNER','CLIENT_MANAGER')
            OR r.observacao ILIKE '%diretor_vendas%' OR r.observacao ILIKE '%assistente_vendas%'));

  -- Fonte ÚNICA do vínculo (a tela Administração › Vendedores grava aqui).
  SELECT a.codigo INTO v_cod
    FROM public.com_vendedor_acesso a
   WHERE a.user_id = v_uid AND a.company_id = p_company_id AND COALESCE(a.ativo, true)
   ORDER BY a.atualizado_em DESC NULLS LAST, a.criado_em DESC
   LIMIT 1;

  -- Cargo do código na hierarquia do ERP de origem (Gerente/Supervisor/Vendedor).
  IF v_cod IS NOT NULL THEN
    SELECT e.cargo INTO v_cargo FROM public.fn_com_equipe(p_company_id) e WHERE e.codigo = v_cod LIMIT 1;
  END IF;

  -- Gerente/Diretor veem tudo (como o líder por papel); precedência do líder.
  IF v_lider OR (v_cargo IS NOT NULL AND (v_cargo ILIKE 'gerente%' OR v_cargo ILIKE 'diretor%')) THEN
    RETURN jsonb_build_object('modo', 'lider');
  END IF;

  -- Vendedor/Supervisor com vínculo: próprio código + toda a equipe abaixo (recursivo pela hierarquia).
  IF v_cod IS NOT NULL THEN
    WITH RECURSIVE eq AS (SELECT codigo, superior FROM public.fn_com_equipe(p_company_id)),
    team AS (
      SELECT v_cod AS codigo
      UNION
      SELECT e.codigo FROM eq e JOIN team t ON e.superior = t.codigo
    )
    SELECT array_agg(DISTINCT codigo) INTO v_cods FROM team;
    IF v_cods IS NULL OR array_length(v_cods,1) IS NULL THEN v_cods := ARRAY[v_cod]; END IF;
    RETURN jsonb_build_object('modo', 'vendedor', 'cod', v_cod, 'cods', to_jsonb(v_cods));
  END IF;

  -- Papel comercial sem vínculo: FAIL-CLOSED (nunca a empresa inteira).
  RETURN jsonb_build_object('modo', 'sem_acesso');
END $function$;

REVOKE ALL ON FUNCTION public.fn_bi_comercial_scope(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_scope(uuid) TO authenticated, service_role;

-- 3) Base: passa a enxergar a EQUIPE (v_cods) além do próprio código; resto idêntico à v5.
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
  -- cods = próprio código + toda a equipe abaixo (scope já expandiu a hierarquia); vazio p/ líder.
  v_cods  := ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_scope->'cods', '[]'::jsonb)));
  IF v_modo IS NULL OR v_modo = 'sem_acesso' THEN
    RAISE EXCEPTION 'sem_acesso_comercial';
  END IF;
  -- v_modo ∈ ('lider','vendedor'); 'vendedor' => o próprio código + a equipe abaixo (v_cods).

  WITH
  -- Espinho de venda (reuso), já filtrado por escopo.
  v AS (
    SELECT i.dia, i.nota, i.vendedor, i.cliente_cod, i.cliente, i.cidade,
           i.produto_cod, i.produto, i.linha, i.carne,
           i.kg, i.valor, i.valor_tabela, i.carga, i.transportador
    FROM public.fn_com_venda_item(p_company_id, v_de, v_ate) i
    WHERE (v_modo = 'lider' OR i.vendedor = ANY(v_cods))
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
      AND (v_modo = 'lider' OR COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'), ''), 's/v') = ANY(v_cods))
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
      AND (v_modo = 'lider' OR COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'), ''), 's/v') = ANY(v_cods))
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
