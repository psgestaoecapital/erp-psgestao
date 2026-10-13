-- ============================================================
-- Categoria de produto · AGRUPAMENTO a partir do ATAK (ind_atak_fato -> raw->>'DESC_PRODUTO_EST').
-- O DOMINIO do ATAK NAO e categoria: 'miudos_5quarto' traz "FEMEA/MACHO PARA ABATE" (18.907, gado
-- vivo), enquanto os miudos reais tem 1 registro cada — o dominio reflete a consulta do Jian, nao o
-- produto. Por isso: listar os produtos mais frequentes por dominio (com a contagem) e deixar o
-- USUARIO agrupar; o sistema NAO decide. Um produto pertence a UMA categoria por planta (kg nao pode
-- ser contado em dobro); atribuir a outra categoria MOVE.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.prod_categoria_item (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plant_id     uuid NOT NULL REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  categoria_id uuid NOT NULL REFERENCES public.prod_categoria_produto(id) ON DELETE CASCADE,
  descricao    text NOT NULL,          -- DESC_PRODUTO_EST do ATAK
  dominio      text,                   -- dominio de onde veio (informativo)
  criado_em    timestamptz NOT NULL DEFAULT now(),
  criado_por   uuid,
  UNIQUE (company_id, plant_id, descricao)   -- um produto em UMA categoria por planta
);
CREATE INDEX IF NOT EXISTS ix_prod_categoria_item_cat ON public.prod_categoria_item(categoria_id);
ALTER TABLE public.prod_categoria_item ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prod_categoria_item_rw ON public.prod_categoria_item;
CREATE POLICY prod_categoria_item_rw ON public.prod_categoria_item FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- fn_prod_atak_produtos · SO LEITURA. Sem dominio: devolve os dominios do ATAK com quantos produtos
--   distintos cada um tem. Com dominio: os DESC_PRODUTO_EST mais frequentes (com a contagem),
--   marcando quais ja estao numa categoria e qual. O usuario decide o que e categoria.
CREATE OR REPLACE FUNCTION public.fn_prod_atak_produtos(p_company_id uuid, p_plant_id uuid, p_dominio text, p_limit int)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_dominios jsonb; v_itens jsonb; v_lim int := coalesce(p_limit, 100);
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('dominio', dominio, 'produtos', n) ORDER BY n DESC), '[]'::jsonb) INTO v_dominios FROM (
    SELECT dominio, count(DISTINCT raw->>'DESC_PRODUTO_EST') AS n
      FROM ind_atak_fato
     WHERE company_id = p_company_id AND coalesce(raw->>'DESC_PRODUTO_EST','') <> ''
     GROUP BY dominio HAVING count(DISTINCT raw->>'DESC_PRODUTO_EST') > 0
  ) d;

  IF p_dominio IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'dominios', v_dominios, 'itens', '[]'::jsonb);
  END IF;

  WITH freq AS (
    SELECT raw->>'DESC_PRODUTO_EST' AS descricao, count(*) AS n
      FROM ind_atak_fato
     WHERE company_id = p_company_id AND dominio = p_dominio AND coalesce(raw->>'DESC_PRODUTO_EST','') <> ''
     GROUP BY 1 ORDER BY count(*) DESC LIMIT v_lim
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('descricao', f.descricao, 'ocorrencias', f.n,
           'categoria_id', ci.categoria_id, 'categoria_nome', cp.nome) ORDER BY f.n DESC, f.descricao), '[]'::jsonb) INTO v_itens
    FROM freq f
    LEFT JOIN prod_categoria_item ci ON ci.company_id = p_company_id AND ci.plant_id = p_plant_id AND ci.descricao = f.descricao
    LEFT JOIN prod_categoria_produto cp ON cp.id = ci.categoria_id;

  RETURN jsonb_build_object('ok', true, 'dominios', v_dominios, 'dominio', p_dominio, 'itens', v_itens);
END $function$;

-- fn_prod_categoria_item_atribuir · poe um produto (DESC_PRODUTO_EST) numa categoria. Upsert: se o
--   produto ja esta em outra categoria da planta, MOVE (nao duplica) — kg nao conta em dobro.
CREATE OR REPLACE FUNCTION public.fn_prod_categoria_item_atribuir(p_categoria_id uuid, p_descricao text, p_dominio text, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_plant uuid; v_id uuid; v_desc text := btrim(coalesce(p_descricao,''));
BEGIN
  SELECT company_id, plant_id INTO v_comp, v_plant FROM prod_categoria_produto WHERE id = p_categoria_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'categoria_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_desc = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'descricao_vazia'); END IF;

  INSERT INTO prod_categoria_item (company_id, plant_id, categoria_id, descricao, dominio, criado_por)
  VALUES (v_comp, v_plant, p_categoria_id, v_desc, NULLIF(btrim(coalesce(p_dominio,'')),''), p_user)
  ON CONFLICT (company_id, plant_id, descricao)
  DO UPDATE SET categoria_id = EXCLUDED.categoria_id, dominio = EXCLUDED.dominio
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- fn_prod_categoria_item_remover · tira um produto da categoria (por id do item).
CREATE OR REPLACE FUNCTION public.fn_prod_categoria_item_remover(p_item_id uuid, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid;
BEGIN
  SELECT company_id INTO v_comp FROM prod_categoria_item WHERE id = p_item_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'item_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  DELETE FROM prod_categoria_item WHERE id = p_item_id;
  RETURN jsonb_build_object('ok', true, 'removido', true);
END $function$;
