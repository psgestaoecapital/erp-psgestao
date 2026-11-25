-- =====================================================================
-- Produtividade/Produtos — "Importar do sistema vinculado": corrige o timeout e passa a trazer o CÓDIGO.
-- CEO 25/11. RD-38. Só a função + índice + ajuda — não altera dado de cliente.
--
-- Causa do timeout (provado no piloto, EXPLAIN ANALYZE): a lista de fontes contava produtos distintos varrendo
-- os domínios inteiros e extraindo jsonb por linha (309k linhas nos 3 domínios de produção → ~13,6 s, CPU-bound).
-- O filtro de 180 dias vive no raw e não casa com o índice (company_id, dominio), então a varredura é integral.
-- Correção (decisão do CEO 25/11):
--   1) Fontes (p_dominio NULL): sem contagem — só os domínios de produção que EXISTEM para a empresa (EXISTS por
--      domínio, usa o índice (company_id, dominio)); "produtos" = null.
--   2) Itens (p_dominio): filtro 180 dias por raw->>'DATA_ESTOQUE' (SEM coalesce, para casar com o índice novo),
--      agrupado por COD_PRODUTO + DESC_PRODUTO_EST; devolve codigo e ja_importado (chave_externa = COD_PRODUTO).
--   3) Índice coberto novo para a faixa de 180 dias (a PR de rendimento por origem cria o mesmo com IF NOT EXISTS).
-- =====================================================================

-- Índice coberto: (company_id, dominio, DATA_ESTOQUE, COD_PRODUTO, DESC_PRODUTO_EST) → index-only scan na janela 180d.
SET LOCAL statement_timeout = '15min';
SET LOCAL lock_timeout = '60s';
CREATE INDEX IF NOT EXISTS idx_ind_atak_fato_prod_data
  ON public.ind_atak_fato (company_id, dominio, (raw->>'DATA_ESTOQUE'), (raw->>'COD_PRODUTO'), (raw->>'DESC_PRODUTO_EST'));

CREATE OR REPLACE FUNCTION public.fn_prod_atak_produtos(p_company_id uuid, p_plant_id uuid, p_dominio text, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_dominios jsonb; v_itens jsonb; v_lim int := coalesce(p_limit, 100);
  v_corte text := (current_date - 180)::text;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- Fontes: só os domínios de produção que existem para a empresa (EXISTS, usa o índice (company_id, dominio)).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('dominio', d, 'produtos', NULL)), '[]'::jsonb) INTO v_dominios
  FROM unnest(ARRAY['producao_frigorifico', 'desossa_rendimento', 'miudos_5quarto']) AS d
  WHERE EXISTS (SELECT 1 FROM ind_atak_fato f WHERE f.company_id = p_company_id AND f.dominio = d);

  IF p_dominio IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'dominios', v_dominios, 'itens', '[]'::jsonb);
  END IF;

  -- Itens: janela de 180 dias (raw->>'DATA_ESTOQUE' SEM coalesce, para o planner usar o índice coberto),
  -- agrupados por COD_PRODUTO + DESC_PRODUTO_EST; traz o código e se já foi importado (chave_externa = COD_PRODUTO).
  WITH freq AS (
    SELECT raw->>'COD_PRODUTO' AS codigo, raw->>'DESC_PRODUTO_EST' AS descricao, count(*) AS n
      FROM ind_atak_fato
     WHERE company_id = p_company_id AND dominio = p_dominio
       AND coalesce(raw->>'DESC_PRODUTO_EST', '') <> ''
       AND raw->>'DATA_ESTOQUE' >= v_corte
     GROUP BY raw->>'COD_PRODUTO', raw->>'DESC_PRODUTO_EST'
     ORDER BY count(*) DESC LIMIT v_lim
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'codigo', f.codigo, 'descricao', f.descricao, 'ocorrencias', f.n,
           'ja_importado', (f.codigo IS NOT NULL AND EXISTS (
             SELECT 1 FROM prod_produto pp
              WHERE pp.company_id = p_company_id AND pp.plant_id = p_plant_id AND pp.chave_externa = f.codigo))
         ) ORDER BY f.n DESC, f.descricao), '[]'::jsonb) INTO v_itens
    FROM freq f;

  RETURN jsonb_build_object('ok', true, 'dominios', v_dominios, 'dominio', p_dominio, 'itens', v_itens);
END $function$;

REVOKE ALL ON FUNCTION public.fn_prod_atak_produtos(uuid, uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_atak_produtos(uuid, uuid, text, integer) TO authenticated, service_role;

-- Ajuda do novo campo "papel" na importação (RD-95).
INSERT INTO erp_ajuda_campo (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, status, versao)
VALUES ('prod.produto.importar_papel', '/dashboard/produtividade/produtos', 'Produtos', 'industrial', 'Papel do produto',
  'Papel do produto no processo: intermediário (entra na desossa — carcaça, quarto, bola) ou produto final (corte pronto). Já vem sugerido; ajuste antes de importar.',
  'Define como o produto entra na árvore de desmontagem e no rendimento.',
  'BOLA DE MÚSCULO → intermediário; COXÃO MOLE → produto final.',
  'A sugestão é automática pelo começo do nome — confira itens que fogem do padrão.', 'publicado', 1)
ON CONFLICT (chave) DO UPDATE SET rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, vertical = EXCLUDED.vertical,
  rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, status = 'publicado', versao = erp_ajuda_campo.versao + 1, atualizado_em = now();
