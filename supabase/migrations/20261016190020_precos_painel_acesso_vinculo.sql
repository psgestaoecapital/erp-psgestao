-- Fix-forward da #2506 (chamado #2710 FCR) — @pos-migration #527 vermelho.
-- Causa provada no dado (RD-38): fn_produtos_precos_painel só aceitava quem tem papel em tenant_user_roles (ou is_admin()),
-- enquanto fn_preco_markup_efetivo / _geral_salvar / _produtos aceitam o vínculo canônico get_user_company_ids()
-- (user_companies + PS_ADMIN/PS_ADMIN_CVM). Usuário vinculado só por user_companies recebia {ok:false, erro:'sem_acesso'}
-- do painel (Formar preços vazio na tela) e ok das demais — por isso painel.config.markup_geral_pct = undefined no teste.
-- Correção: a mesma guarda das funções irmãs (vínculo OU papel ativo OU is_admin). O resto da função fica idêntico.
-- O papel continua vindo de tenant_user_roles para esconder custo de operador/mecânico.

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
  -- mesma guarda das funções irmãs: vínculo canônico (user_companies / PS_ADMIN) OU papel ativo OU admin
  IF v_papel IS NULL AND NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

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
