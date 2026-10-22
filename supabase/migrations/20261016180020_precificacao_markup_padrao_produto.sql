-- GE · Precificação — MARKUP PADRÃO: geral da empresa + por produto + alteração em massa (chamado #2710 FCR · jordana-code
-- · faixa 20 · pedido 13/10 da Jordana pelo Canal PS).
--
-- O que muda:
--  1) Markup GERAL da empresa e markup PRÓPRIO do produto. Produto sem o próprio usa o geral (40% num produto e 30% geral →
--     esse produto usa 40%, os outros 30%).
--  2) Alteração em massa com PRÉVIA: escolhe os produtos (todos, categoria, fornecedor, busca ou lista marcada), vê o
--     antes → depois e só grava quando confirmar (RD-55). Também remove o próprio (volta a usar o geral).
--  3) "Formar preços" ganha o modo 'markup_padrao': preço novo = custo × (1 + markup do produto, ou o geral).
--  4) fn_preco_markup_efetivo devolve o markup e o preço sugerido de um produto para um custo — serve a tela de cadastro e
--     a entrada da nota (preço sugerido na compra).
--
-- RD-26 — REAPROVEITA a tabela erp_preco_regra (criada na NF-e F4, 29/08, escopo/base/percentual, RLS por empresa, hoje
-- vazia): regra escopo 'empresa' = markup geral; escopo 'produto' (escopo_id = produto) = markup próprio. NÃO cria coluna
-- em erp_produtos (núcleo usado por todas as verticais).
-- Aditiva: índice NOVO + funções NOVAS + CREATE OR REPLACE ADITIVO de fn_produtos_precos_painel (lida a versão viva antes:
-- md5 do corpo = 073ed435… = migration 20261013160030; só ACRESCENTA o modo 'markup_padrao', as colunas markup_padrao_pct/
-- markup_origem e config.markup_geral_pct — os modos 'margem'/'markup' e o resto ficam idênticos). Sem DROP/DELETE/TRUNCATE.
-- Guarda de empresa + search_path + REVOKE anon em todas. Via revisada (SECURITY DEFINER).

-- uma regra de markup ATIVA por (empresa, escopo, alvo) — a tabela está vazia em produção (conferido 13/10)
CREATE UNIQUE INDEX IF NOT EXISTS ux_erp_preco_regra_markup_ativa
  ON public.erp_preco_regra (company_id, escopo, COALESCE(escopo_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE ativo AND base = 'markup';

-- ── Markup efetivo de um produto (+ preço sugerido para um custo) ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_preco_markup_efetivo(
  p_company_id uuid,
  p_produto_id uuid DEFAULT NULL,   -- NULL = só o geral
  p_custo      numeric DEFAULT NULL) -- informado → devolve o preço sugerido (custo × (1 + markup))
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_geral   numeric;
  v_proprio numeric;
  v_mk      numeric;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT percentual INTO v_geral FROM erp_preco_regra
   WHERE company_id = p_company_id AND escopo = 'empresa' AND base = 'markup' AND ativo
   ORDER BY criado_em DESC LIMIT 1;
  IF p_produto_id IS NOT NULL THEN
    SELECT r.percentual INTO v_proprio FROM erp_preco_regra r
      JOIN erp_produtos p ON p.id = r.escopo_id AND p.company_id = p_company_id
     WHERE r.company_id = p_company_id AND r.escopo = 'produto' AND r.escopo_id = p_produto_id AND r.base = 'markup' AND r.ativo
     ORDER BY r.criado_em DESC LIMIT 1;
  END IF;
  v_mk := COALESCE(v_proprio, v_geral);

  RETURN jsonb_build_object('ok', true,
    'markup_geral_pct', v_geral,
    'markup_produto_pct', v_proprio,
    'markup_pct', v_mk,
    'origem', CASE WHEN v_proprio IS NOT NULL THEN 'produto' WHEN v_geral IS NOT NULL THEN 'geral' END,
    'preco_sugerido', CASE WHEN v_mk IS NOT NULL AND COALESCE(p_custo, 0) > 0 THEN round(p_custo * (1 + v_mk / 100), 2) END);
END $function$;
REVOKE ALL ON FUNCTION public.fn_preco_markup_efetivo(uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_preco_markup_efetivo(uuid, uuid, numeric) TO authenticated, service_role;

-- ── Markup GERAL da empresa (NULL = tirar o geral) ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_preco_markup_geral_salvar(p_company_id uuid, p_markup_pct numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_papel text;
  v_antes numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  -- quem não vê custo (operador/mecânico) não forma preço
  SELECT role INTO v_papel FROM tenant_user_roles WHERE user_id = v_uid AND company_id = p_company_id AND is_active LIMIT 1;
  IF COALESCE(v_papel, '') IN ('CLIENT_OPERATOR', 'OFICINA_MECANICO') AND NOT is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao'); END IF;
  IF p_markup_pct IS NOT NULL AND (p_markup_pct < 0 OR p_markup_pct > 1000) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'markup_invalido'); END IF;

  SELECT percentual INTO v_antes FROM erp_preco_regra
   WHERE company_id = p_company_id AND escopo = 'empresa' AND base = 'markup' AND ativo LIMIT 1;
  UPDATE erp_preco_regra SET ativo = false
   WHERE company_id = p_company_id AND escopo = 'empresa' AND base = 'markup' AND ativo;
  IF p_markup_pct IS NOT NULL THEN
    INSERT INTO erp_preco_regra (company_id, escopo, escopo_id, base, percentual, ativo)
      VALUES (p_company_id, 'empresa', NULL, 'markup', p_markup_pct, true);
  END IF;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    SELECT p_company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'erp_preco_regra', NULL, 'MARKUP_GERAL',
      jsonb_build_object('markup_pct', v_antes), jsonb_build_object('markup_pct', p_markup_pct);

  RETURN jsonb_build_object('ok', true, 'markup_geral_pct', p_markup_pct, 'antes', v_antes);
END $function$;
REVOKE ALL ON FUNCTION public.fn_preco_markup_geral_salvar(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_preco_markup_geral_salvar(uuid, numeric) TO authenticated, service_role;

-- ── Markup PRÓPRIO por produto, em massa, com PRÉVIA (p_gravar=false só mostra; true grava) ─────────────────────────
-- Seleção: p_produto_ids (marcados) OU filtros (categoria, fornecedor, busca) OU p_todos=true. Sem nenhum → recusa,
-- para nunca alterar a empresa inteira sem querer. p_remover=true tira o próprio (o produto volta a usar o geral).
CREATE OR REPLACE FUNCTION public.fn_preco_markup_produtos(
  p_company_id  uuid,
  p_markup_pct  numeric DEFAULT NULL,
  p_remover     boolean DEFAULT false,
  p_produto_ids uuid[]  DEFAULT NULL,
  p_categoria   text    DEFAULT NULL,
  p_fornecedor  text    DEFAULT NULL,
  p_busca       text    DEFAULT NULL,
  p_todos       boolean DEFAULT false,
  p_gravar      boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_papel text;
  v_cat   text := NULLIF(btrim(COALESCE(p_categoria, '')), '');
  v_forn  text := NULLIF(btrim(COALESCE(p_fornecedor, '')), '');
  v_busca text := NULLIF(btrim(COALESCE(p_busca, '')), '');
  v_geral numeric;
  v_ids   uuid[];
  v_rows  jsonb;
  v_n     int;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT role INTO v_papel FROM tenant_user_roles WHERE user_id = v_uid AND company_id = p_company_id AND is_active LIMIT 1;
  IF COALESCE(v_papel, '') IN ('CLIENT_OPERATOR', 'OFICINA_MECANICO') AND NOT is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao'); END IF;
  IF NOT COALESCE(p_remover, false) AND (p_markup_pct IS NULL OR p_markup_pct < 0 OR p_markup_pct > 1000) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'markup_invalido'); END IF;
  IF COALESCE(array_length(p_produto_ids, 1), 0) = 0 AND v_cat IS NULL AND v_forn IS NULL AND v_busca IS NULL
     AND NOT COALESCE(p_todos, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_selecao'); END IF;

  SELECT percentual INTO v_geral FROM erp_preco_regra
   WHERE company_id = p_company_id AND escopo = 'empresa' AND base = 'markup' AND ativo LIMIT 1;

  WITH alvo AS (
    SELECT p.id, p.codigo, p.nome,
           COALESCE(NULLIF(p.preco_custo_medio, 0), p.preco_custo, 0) AS custo,
           (SELECT r.percentual FROM erp_preco_regra r
             WHERE r.company_id = p_company_id AND r.escopo = 'produto' AND r.escopo_id = p.id AND r.base = 'markup' AND r.ativo
             LIMIT 1) AS proprio
      FROM erp_produtos p
     WHERE p.company_id = p_company_id AND COALESCE(p.ativo, true)
       AND (COALESCE(array_length(p_produto_ids, 1), 0) = 0 OR p.id = ANY (p_produto_ids))
       AND (v_cat   IS NULL OR p.categoria ILIKE v_cat OR p.grupo ILIKE v_cat)
       AND (v_forn  IS NULL OR p.fornecedor_padrao_nome ILIKE '%' || v_forn || '%')
       AND (v_busca IS NULL OR p.nome ILIKE '%' || v_busca || '%' OR p.codigo ILIKE '%' || v_busca || '%')
  )
  SELECT array_agg(a.id), count(*)::int,
         COALESCE(jsonb_agg(jsonb_build_object(
           'produto_id', a.id, 'codigo', a.codigo, 'nome', a.nome, 'custo', a.custo,
           'markup_antes', COALESCE(a.proprio, v_geral),
           'origem_antes', CASE WHEN a.proprio IS NOT NULL THEN 'produto' WHEN v_geral IS NOT NULL THEN 'geral' END,
           'markup_depois', CASE WHEN p_remover THEN v_geral ELSE p_markup_pct END,
           'origem_depois', CASE WHEN NOT p_remover THEN 'produto' WHEN v_geral IS NOT NULL THEN 'geral' END,
           'preco_sugerido_depois', CASE WHEN a.custo > 0 AND (CASE WHEN p_remover THEN v_geral ELSE p_markup_pct END) IS NOT NULL
                                        THEN round(a.custo * (1 + (CASE WHEN p_remover THEN v_geral ELSE p_markup_pct END) / 100), 2) END
         ) ORDER BY a.nome), '[]'::jsonb)
    INTO v_ids, v_n, v_rows
    FROM alvo a;

  IF NOT COALESCE(p_gravar, false) THEN
    RETURN jsonb_build_object('ok', true, 'gravado', false, 'total', v_n, 'markup_geral_pct', v_geral, 'produtos', v_rows);
  END IF;
  IF v_n = 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'nenhum_produto'); END IF;

  -- grava: desliga o próprio atual dos selecionados e, se não for remoção, cria o novo (uma regra ativa por produto)
  UPDATE erp_preco_regra SET ativo = false
   WHERE company_id = p_company_id AND escopo = 'produto' AND base = 'markup' AND ativo AND escopo_id = ANY (v_ids);
  IF NOT COALESCE(p_remover, false) THEN
    INSERT INTO erp_preco_regra (company_id, escopo, escopo_id, base, percentual, ativo)
      SELECT p_company_id, 'produto', u, 'markup', p_markup_pct, true FROM unnest(v_ids) u;
  END IF;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_novo)
    SELECT p_company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'erp_preco_regra', NULL, 'MARKUP_PRODUTOS',
      jsonb_build_object('markup_pct', CASE WHEN p_remover THEN NULL ELSE p_markup_pct END, 'remover', COALESCE(p_remover, false),
        'produtos', v_n, 'produto_ids', to_jsonb(v_ids),
        'filtro', jsonb_build_object('categoria', v_cat, 'fornecedor', v_forn, 'busca', v_busca, 'todos', COALESCE(p_todos, false)));

  RETURN jsonb_build_object('ok', true, 'gravado', true, 'total', v_n, 'markup_geral_pct', v_geral, 'produtos', v_rows);
END $function$;
REVOKE ALL ON FUNCTION public.fn_preco_markup_produtos(uuid, numeric, boolean, uuid[], text, text, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_preco_markup_produtos(uuid, numeric, boolean, uuid[], text, text, text, boolean, boolean) TO authenticated, service_role;

-- ── Painel de preços: + modo 'markup_padrao' e o markup de cada produto (CREATE OR REPLACE aditivo) ─────────────────
CREATE OR REPLACE FUNCTION public.fn_produtos_precos_painel(
  p_company_id uuid,
  p_filtro     text DEFAULT 'todos',     -- 'todos' | 'sem_preco' | 'margem_negativa' | 'com_custo'
  p_busca      text DEFAULT NULL,         -- nome / código
  p_modo       text DEFAULT NULL,         -- NULL = só listar | 'margem' | 'markup' | 'markup_padrao' (liga a PRÉVIA)
  p_valor      numeric DEFAULT NULL,      -- margem alvo % ('margem') ou markup % ('markup'); ignorado em 'markup_padrao'
  p_arredondar text DEFAULT 'nenhum')     -- 'nenhum' | 'real' | 'noventa' (,90) | 'noventa_nove' (,99)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_papel    text;
  v_custo    boolean;
  v_busca    text := NULLIF(btrim(COALESCE(p_busca, '')), '');
  v_modo     text := NULLIF(lower(COALESCE(p_modo, '')), '');
  v_total    int;
  v_sem      int;
  v_abaixo   int;
  v_rows     jsonb;
  v_dummy    jsonb;
  v_imp_cfg  boolean;
  v_imp_ovr  numeric;
  v_meta     numeric;
  v_min      numeric;
  v_mk_geral numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;

  -- multi-tenant: só a empresa de que o usuário é membro ativo
  SELECT role INTO v_papel
    FROM tenant_user_roles WHERE user_id = v_uid AND company_id = p_company_id AND is_active LIMIT 1;
  IF v_papel IS NULL AND NOT is_admin() THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- custo/valor só para quem pode ver (equipe de campo / mecânico não vê valores)
  v_custo := COALESCE(v_papel, '') NOT IN ('CLIENT_OPERATOR', 'OFICINA_MECANICO');
  IF v_modo IS NOT NULL AND v_modo NOT IN ('margem', 'markup', 'markup_padrao') THEN v_modo := NULL; END IF;

  -- config da empresa: imposto configurado? (uma chamada ao motor com custo/preço de teste — lê o aviso dele, sem
  -- duplicar a regra) + override atual e a margem meta/mínima (tabela de parâmetros do GE).
  v_dummy := fn_produto_margem_real(p_company_id, 100, 200, NULL);
  v_imp_cfg := NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(v_dummy->'avisos', '[]'::jsonb)) a
     WHERE a ILIKE '%imposto de venda não configurado%');
  SELECT imposto_venda_pct, margem_meta_pct, margem_minima_pct INTO v_imp_ovr, v_meta, v_min
    FROM erp_precificacao_parametros WHERE company_id = p_company_id;
  -- markup GERAL da empresa (chamado #2710): regra ativa de escopo 'empresa' em erp_preco_regra
  SELECT r.percentual INTO v_mk_geral FROM erp_preco_regra r
   WHERE r.company_id = p_company_id AND r.escopo = 'empresa' AND r.base = 'markup' AND r.ativo
   ORDER BY r.criado_em DESC LIMIT 1;

  -- base: produtos ativos da empresa, com o custo efetivo (médio, cai p/ preco_custo quando médio = 0)
  WITH base AS (
    SELECT p.id, p.codigo, p.nome, p.unidade, p.grupo,
           COALESCE(p.estoque_atual, 0)                                AS estoque,
           COALESCE(NULLIF(p.preco_custo_medio, 0), p.preco_custo, 0)  AS custo,
           COALESCE(p.preco_venda, 0)                                  AS preco_hoje,
           rp.percentual                                               AS markup_proprio
      FROM erp_produtos p
      LEFT JOIN LATERAL (SELECT r.percentual FROM erp_preco_regra r
                          WHERE r.company_id = p.company_id AND r.escopo = 'produto' AND r.escopo_id = p.id
                            AND r.base = 'markup' AND r.ativo ORDER BY r.criado_em DESC LIMIT 1) rp ON true
     WHERE p.company_id = p_company_id AND COALESCE(p.ativo, true) = true
  ),
  tot AS (
    SELECT count(*)::int                                                        AS total_ativos,
           count(*) FILTER (WHERE preco_hoje <= 0)::int                         AS sem_preco,
           count(*) FILTER (WHERE preco_hoje > 0 AND custo > 0 AND preco_hoje < custo)::int AS abaixo_custo
      FROM base
  ),
  filtrada AS (
    SELECT b.*,
      CASE WHEN b.custo > 0 AND b.preco_hoje > 0
           THEN (fn_produto_margem_real(p_company_id, b.custo, b.preco_hoje, b.id) ->> 'margem_liquida_pct')::numeric
      END AS margem_hoje_pct,
      CASE WHEN v_modo = 'markup' AND b.custo > 0 THEN b.custo * (1 + COALESCE(p_valor, 0) / 100)
           -- markup padrão: o do produto; sem o próprio, o geral da empresa; sem nenhum, fica sem preço novo
           WHEN v_modo = 'markup_padrao' AND b.custo > 0 AND COALESCE(b.markup_proprio, v_mk_geral) IS NOT NULL
                THEN b.custo * (1 + COALESCE(b.markup_proprio, v_mk_geral) / 100)
           WHEN v_modo = 'margem' AND b.custo > 0 THEN (fn_produto_preco_por_margem(p_company_id, b.custo, p_valor, b.id) ->> 'preco_sugerido')::numeric
      END AS preco_cru
      FROM base b
     WHERE (p_filtro <> 'sem_preco'       OR b.preco_hoje <= 0)
       AND (p_filtro <> 'margem_negativa' OR (b.preco_hoje > 0 AND b.custo > 0 AND b.preco_hoje < b.custo))
       AND (p_filtro <> 'com_custo'       OR b.custo > 0)
       AND (v_busca IS NULL OR b.nome ILIKE '%' || v_busca || '%' OR b.codigo ILIKE '%' || v_busca || '%')
  ),
  calc AS (
    SELECT f.*,
      CASE
        WHEN f.preco_cru IS NULL OR f.preco_cru <= 0 THEN NULL
        WHEN p_arredondar = 'real'         THEN ceil(f.preco_cru)
        WHEN p_arredondar = 'noventa'      THEN floor(f.preco_cru) + CASE WHEN f.preco_cru - floor(f.preco_cru) > 0.90 THEN 1.90 ELSE 0.90 END
        WHEN p_arredondar = 'noventa_nove' THEN floor(f.preco_cru) + CASE WHEN f.preco_cru - floor(f.preco_cru) > 0.99 THEN 1.99 ELSE 0.99 END
        ELSE round(f.preco_cru, 2)
      END AS preco_novo
      FROM filtrada f
  )
  SELECT (SELECT total_ativos FROM tot), (SELECT sem_preco FROM tot), (SELECT abaixo_custo FROM tot),
         COALESCE(jsonb_agg(jsonb_build_object(
           'produto_id', c.id, 'codigo', c.codigo, 'nome', c.nome, 'unidade', c.unidade,
           'estoque', c.estoque,
           'custo',            CASE WHEN v_custo THEN c.custo END,
           'preco_hoje',       c.preco_hoje,
           'markup_padrao_pct', CASE WHEN v_custo THEN COALESCE(c.markup_proprio, v_mk_geral) END,
           'markup_origem',    CASE WHEN NOT v_custo THEN NULL WHEN c.markup_proprio IS NOT NULL THEN 'produto'
                                    WHEN v_mk_geral IS NOT NULL THEN 'geral' END,
           'margem_hoje_pct',  CASE WHEN v_custo THEN c.margem_hoje_pct END,
           'preco_novo',       CASE WHEN v_custo THEN c.preco_novo END,
           'margem_nova_pct',  CASE WHEN v_custo AND c.preco_novo > 0
                                     THEN (fn_produto_margem_real(p_company_id, c.custo, c.preco_novo, c.id) ->> 'margem_liquida_pct')::numeric END
         ) ORDER BY (c.preco_hoje <= 0) DESC, c.margem_hoje_pct ASC NULLS LAST, c.nome), '[]'::jsonb)
    INTO v_total, v_sem, v_abaixo, v_rows
    FROM calc c;

  RETURN jsonb_build_object('ok', true,
    'pode_ver_custo', v_custo,
    'total_ativos', v_total, 'sem_preco', v_sem, 'abaixo_custo', v_abaixo,
    'modo', v_modo, 'valor', p_valor, 'arredondar', p_arredondar,
    'config', jsonb_build_object(
      'imposto_configurado', v_imp_cfg,
      'imposto_pct',         (v_dummy->'deducoes'->'pct'->>'imposto')::numeric,
      'imposto_override',    v_imp_ovr,
      'imposto_fonte',       v_dummy->>'fonte_imposto',
      'margem_meta_pct',     v_meta,
      'margem_minima_pct',   v_min,
      'markup_geral_pct',    CASE WHEN v_custo THEN v_mk_geral END),
    'produtos', v_rows);
END $function$;
REVOKE ALL ON FUNCTION public.fn_produtos_precos_painel(uuid, text, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_produtos_precos_painel(uuid, text, text, text, numeric, text) TO authenticated, service_role;

-- RD-95: "?" dos campos novos
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES
 ('compras.precificacao.markup_geral', '/dashboard/compras/precificacao', 'Precificação', 'Markup geral da empresa',
  'O percentual que você soma sobre o custo de TODOS os produtos que não têm um markup próprio. Deixe em branco para não ter geral.',
  'É o markup padrão da loja: entra no "Formar preços › Markup padrão de cada produto" e no preço sugerido da entrada da nota para os produtos sem markup próprio.',
  'Geral 30%: produto de custo R$ 10,00 sugere R$ 13,00.',
  'Achar que markup 30% dá margem de 30%: não dá — imposto, comissão e custo fixo saem do preço. Confira na "Conta do preço".',
  'gestao_empresarial', 'publicado'),
 ('compras.precificacao.markup_produto', '/dashboard/compras/precificacao', 'Precificação', 'Markup do produto',
  'O markup próprio deste produto, em %. Quando preenchido, vale no lugar do geral só para ele.',
  'Produtos com giro ou custo diferente pedem markup diferente: o próprio manda; sem ele, vale o geral (a coluna mostra de onde veio).',
  'Geral 30% e este produto 40%: custo R$ 10,00 sugere R$ 14,00; os outros, R$ 13,00.',
  'Esquecer que o próprio continua valendo depois de mudar o geral: use "Voltar ao geral" para tirar o próprio.',
  'gestao_empresarial', 'publicado'),
 ('compras.precificacao.markup_massa', '/dashboard/compras/precificacao', 'Precificação', 'Alterar markup em massa',
  'Escolha os produtos (todos, por categoria, por fornecedor, pela busca ou marcando na lista), o novo markup e clique em "Ver prévia". Só grava em "Gravar markup".',
  'Mudar o markup de muitos produtos de uma vez sem errar: a prévia mostra o markup de antes, o de depois e o preço que ele sugere.',
  'Categoria "Tintas", markup 45% → prévia com 12 produtos → Gravar markup.',
  'Gravar sem filtro achando que é só um produto: sem nenhum filtro o sistema recusa; para a empresa inteira marque "Todos".',
  'gestao_empresarial', 'publicado'),
 ('compras.precificacao.markup_massa_filtro', '/dashboard/compras/precificacao', 'Precificação', 'Quais produtos',
  'Categoria (ou grupo), parte do nome do fornecedor padrão, ou parte do nome/código do produto. Pode combinar. "Todos" pega a empresa inteira.',
  'Define em quais produtos o novo markup será aplicado. A prévia mostra exatamente a lista antes de gravar.',
  'Fornecedor "Suvinil" → todos os produtos com esse fornecedor padrão.',
  'Produto sem categoria/fornecedor cadastrados não entra no filtro: use a busca ou marque na lista.',
  'gestao_empresarial', 'publicado'),
 ('compras.precificacao.markup_padrao_modo', '/dashboard/compras/precificacao', 'Precificação', 'Markup padrão de cada produto',
  'Opção do "Formar preços": usa o markup próprio de cada produto e, onde não houver, o geral da empresa. O percentual digitado é ignorado.',
  'Formar todos os preços de uma vez respeitando o markup de cada produto. Produto sem markup próprio e sem geral fica sem preço novo.',
  'Produto A (40%) custo R$ 10 → R$ 14,00; produto B (sem próprio, geral 30%) custo R$ 10 → R$ 13,00.',
  'Escolher este modo sem ter markup geral nem próprio: nenhum preço novo aparece na prévia.',
  'gestao_empresarial', 'publicado')
ON CONFLICT (chave) DO NOTHING;
