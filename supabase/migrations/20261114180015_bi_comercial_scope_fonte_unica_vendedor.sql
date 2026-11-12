-- Escopo de dados do painel comercial v7: FONTE ÚNICA = com_vendedor_acesso (RD-71)
-- -----------------------------------------------------------------------------
-- Contexto (Eng. Chefe 12/11): a tela Administração › Vendedores grava o vínculo
-- usuário ↔ código de vendedor em com_vendedor_acesso (fn_com_vendedor_acesso_salvar),
-- e o painel ANTIGO (fn_bi_comercial_painel) já respeita esse vínculo. O painel v7
-- (fn_bi_comercial_base) usa fn_bi_comercial_scope, que lia OUTRA tabela
-- (bi_comercial_vendedor) — duas fontes para a mesma coisa (RD-71). Efeito: ligar um
-- vendedor na tela de Vendedores NÃO restringia o v7 → um vendedor logado veria vendas
-- e preços da empresa inteira. O CEO vai liberar o app/painel para os vendedores da
-- Frioeste, então o escopo precisa valer no v7.
--
-- Esta migration (ADITIVA, sem apagar nada):
--   1. fn_bi_comercial_scope passa a ler com_vendedor_acesso (ativo) como fonte única,
--      respeitando a HIERARQUIA (fn_com_equipe): vendedor vê o próprio código;
--      supervisor vê a própria subárvore (equipe); gerente/diretor/sócio vê a empresa.
--      Devolve, além de 'cod', a lista 'cods' (código próprio + subárvore).
--   2. FAIL-CLOSED: usuário da empresa SEM vínculo e SEM papel de liderança recebe o
--      modo 'sem_vinculo' — nunca a empresa inteira.
--   3. fn_bi_comercial_base passa a filtrar por ANY(cods) (antes: um único código) e a
--      devolver a frase certa para 'sem_vinculo' e 'sem_acesso'.
--   4. Migra o que houver em bi_comercial_vendedor para com_vendedor_acesso (idempotente),
--      SEM apagar a tabela bi_comercial_vendedor (RD-30).
--
-- Nada de RLS/grant/menu/dado de cliente é tocado aqui. Padrão aditivo, SECURITY DEFINER
-- igual ao que já existia.

-- 1) Migração de vínculos legados (se houver) — idempotente, não apaga a origem (RD-30)
INSERT INTO public.com_vendedor_acesso (company_id, user_id, codigo, ativo, criado_por, atualizado_por)
SELECT b.company_id, b.user_id, b.cod_vend_comp, true, b.user_id, b.user_id
  FROM public.bi_comercial_vendedor b
 WHERE b.user_id IS NOT NULL AND b.cod_vend_comp IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.com_vendedor_acesso a
      WHERE a.company_id = b.company_id AND a.user_id = b.user_id)
ON CONFLICT (company_id, user_id) DO NOTHING;

-- 2) fn_bi_comercial_scope: fonte única + hierarquia + fail-closed
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_scope(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_raiz  text;
  v_role  text;
  v_lider boolean;
  v_cods  text[];
BEGIN
  -- Sem login ou sem acesso à empresa → nada (fail-closed).
  IF v_uid IS NULL
     OR NOT (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('modo', 'sem_acesso');
  END IF;

  -- Fonte ÚNICA do vínculo (RD-71): com_vendedor_acesso ativo. É o que a tela
  -- Administração › Vendedores grava (fn_com_vendedor_acesso_salvar).
  SELECT a.codigo INTO v_raiz
    FROM public.com_vendedor_acesso a
   WHERE a.company_id = p_company_id AND a.user_id = v_uid AND a.ativo
   LIMIT 1;

  -- Vínculo tem PRECEDÊNCIA (mesma regra do painel antigo): vendedor/supervisor
  -- vê o próprio código + toda a subárvore da hierarquia (fn_com_equipe).
  IF v_raiz IS NOT NULL THEN
    WITH RECURSIVE eq AS (SELECT * FROM public.fn_com_equipe(p_company_id)),
    sub(no, cod) AS (
      SELECT codigo, codigo FROM eq
      UNION
      SELECT s.no, e.codigo FROM sub s JOIN eq e ON e.superior = s.cod
    )
    SELECT array_agg(DISTINCT cod) INTO v_cods FROM sub WHERE no = v_raiz;
    -- Garante o próprio código mesmo que ele não esteja na hierarquia importada
    -- (fail-closed: um vínculo nunca vira "empresa" por acaso).
    SELECT array_agg(DISTINCT c) INTO v_cods
      FROM unnest(COALESCE(v_cods, '{}'::text[]) || ARRAY[v_raiz]) c
     WHERE c IS NOT NULL;
    RETURN jsonb_build_object('modo', 'vendedor', 'cod', v_raiz, 'cods', to_jsonb(v_cods));
  END IF;

  -- Sem vínculo: só papéis de liderança veem a empresa inteira.
  v_lider := public.is_admin() OR public.fn_owner_pode_gerir_escopo(p_company_id);
  IF NOT v_lider THEN
    SELECT uc.role INTO v_role FROM public.user_companies uc
      WHERE uc.company_id = p_company_id AND uc.user_id = v_uid LIMIT 1;
    v_lider := v_role IN ('owner','socio','acesso_total','adm','admin','diretor','diretor_area','gerente');
  END IF;

  IF v_lider THEN
    RETURN jsonb_build_object('modo', 'lider');
  END IF;

  -- Fail-closed: usuário da empresa sem vínculo e sem papel de liderança NÃO vê a
  -- empresa inteira — a tela mostra "ligue seu código de vendedor".
  RETURN jsonb_build_object('modo', 'sem_vinculo');
END $function$;

-- 3) fn_bi_comercial_base: consome 'cods' (subárvore) e trata 'sem_vinculo'
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_base(p_company_id uuid, p_de date DEFAULT NULL::date, p_ate date DEFAULT NULL::date)
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

  -- Guarda de escopo (fonte única com_vendedor_acesso). Fail-closed.
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  v_modo  := v_scope->>'modo';
  IF v_modo = 'vendedor' THEN
    v_cods := ARRAY(SELECT jsonb_array_elements_text(v_scope->'cods'));
  END IF;

  -- Mensagens em linguagem do usuário (erroAmigavel passa a frase com espaços como está).
  IF v_modo = 'sem_vinculo' THEN
    RAISE EXCEPTION 'Seu usuário ainda não está ligado a um código de vendedor — fale com o administrador em Administração › Vendedores.';
  END IF;
  IF v_modo IS NULL OR v_modo = 'sem_acesso' THEN
    RAISE EXCEPTION 'Você não tem acesso ao painel comercial desta empresa.';
  END IF;
  -- v_modo ∈ ('lider','vendedor'); 'vendedor' => só os códigos da própria subárvore.

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

REVOKE ALL ON FUNCTION public.fn_bi_comercial_scope(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_bi_comercial_base(uuid, date, date) FROM anon;
