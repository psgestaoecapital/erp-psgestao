-- SPEC COM-1 · VÍNCULO NF-e ↔ PRODUTO — reforço do casamento (destravar entrada de estoque).
-- Piloto KGF. RD-55: NÃO movimenta estoque sozinho — só sugere; o humano confirma e dá entrada.
--
-- AUDITADO 28/08 (RD-26/44/45 — corrige a premissa da SPEC): a infra JÁ EXISTE e é reusada:
--   · tabela de-para  = erp_produto_depara_fornecedor (a SPEC pediria erp_fornecedor_produto_depara — NÃO recriar)
--   · vincular+aprende = fn_nfe_item_vincular(item,produto,fixar_depara)  → grava a de-para (ON CONFLICT)
--   · marcar não-estoque = fn_nfe_item_set_entra_estoque · entrada = fn_nfe_recebida_dar_entrada_estoque
--   · criar produto = fn_erp_produto_salvar (canônica; NÃO faz INSERT direto)
-- Esta migração só ADICIONA o que falta:
--   1) coluna codigo_barras nos itens (o cEAN não estava em lugar nenhum — só no xml_raw) + backfill;
--   2) reforça fn_nfe_item_depara_sugerir: cascata EAN → de-para → código → NCM+trigram → descrição,
--      com sugestão/alternativas/confiança/score, SEM auto-vincular o que não é exato;
--   3) fn_nfe_item_criar_produto (um clique: item vira produto, herda EAN/NCM/custo, vincula e aprende).
--
-- Calibragem (RD-44/45): os limiares 0,6/0,4 da SPEC não casam a base real (descrições automotivas ruidosas,
-- ex.: "PISTAO ... 206/307/C3 1.6 16V" → similarity ~0,2–0,35). Como #4/#5 são SUGESTÃO (humano confirma),
-- calibrei para priorizar MESMO NCM + trigram — surge o candidato da categoria certa sem falso "vinculado".

-- ── 1) cEAN por item (aditivo) ────────────────────────────────────────────────
ALTER TABLE public.erp_nfe_recebidas_itens
  ADD COLUMN IF NOT EXISTS codigo_barras text;

-- backfill do xml_raw (namespace-agnóstico via local-name(); correlação por ordem = numero_item).
-- 'SEM GTIN' / vazio → fica NULL (nunca casar por isso).
UPDATE public.erp_nfe_recebidas_itens i
   SET codigo_barras = sub.ean
  FROM (
    SELECT n.id AS nfe_id, t.ord::int AS numero_item,
           NULLIF(regexp_replace(
             COALESCE((xpath('.//*[local-name()="cEAN"]/text()', t.node))[1]::text, ''), '\D', '', 'g'), '') AS ean
    FROM public.erp_nfe_recebidas n
    CROSS JOIN LATERAL unnest(xpath('//*[local-name()="det"]', n.xml_raw::xml)) WITH ORDINALITY AS t(node, ord)
    WHERE n.xml_raw IS NOT NULL AND n.xml_raw LIKE '%<%'
  ) sub
 WHERE i.nfe_recebida_id = sub.nfe_id AND i.numero_item = sub.numero_item
   AND i.codigo_barras IS NULL AND sub.ean IS NOT NULL;

-- ── 2) fn_nfe_item_depara_sugerir REFORÇADA (reusa a mesma assinatura; a tela já a chama) ──
CREATE OR REPLACE FUNCTION public.fn_nfe_item_depara_sugerir(p_nfe_recebida_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid; v_cnpj text; r record; p record;
  v_out jsonb := '[]'::jsonb; v_sug jsonb; v_alt jsonb; v_auto boolean;
  v_ean text; v_cpid uuid; v_cnome text; v_corigem text; v_entra boolean;
BEGIN
  SELECT company_id, regexp_replace(COALESCE(emitente_cnpj,''),'\D','','g')
    INTO v_company, v_cnpj FROM erp_nfe_recebidas WHERE id = p_nfe_recebida_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nota nao encontrada'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem permissao'); END IF;

  -- self-heal: popula codigo_barras dos itens desta nota a partir do xml_raw (idempotente).
  BEGIN
    UPDATE erp_nfe_recebidas_itens i
       SET codigo_barras = sub.ean
      FROM (
        SELECT t.ord::int AS numero_item,
               NULLIF(regexp_replace(
                 COALESCE((xpath('.//*[local-name()="cEAN"]/text()', t.node))[1]::text,''), '\D','','g'), '') AS ean
        FROM erp_nfe_recebidas n
        CROSS JOIN LATERAL unnest(xpath('//*[local-name()="det"]', n.xml_raw::xml)) WITH ORDINALITY AS t(node, ord)
        WHERE n.id = p_nfe_recebida_id AND n.xml_raw IS NOT NULL AND n.xml_raw LIKE '%<%'
      ) sub
     WHERE i.nfe_recebida_id = p_nfe_recebida_id AND i.numero_item = sub.numero_item
       AND i.codigo_barras IS NULL AND sub.ean IS NOT NULL;
  EXCEPTION WHEN others THEN NULL;  -- xml inválido nunca derruba a sugestão
  END;

  FOR r IN SELECT * FROM erp_nfe_recebidas_itens WHERE nfe_recebida_id = p_nfe_recebida_id ORDER BY numero_item LOOP
    v_cpid := r.produto_id; v_corigem := NULL; v_cnome := NULL;
    IF v_cpid IS NOT NULL THEN
      v_corigem := r.vinculo_origem;
      SELECT nome INTO v_cnome FROM erp_produtos WHERE id = v_cpid;
    END IF;
    v_ean := NULLIF(regexp_replace(COALESCE(r.codigo_barras,''),'\D','','g'), '');
    v_sug := NULL; v_auto := false; v_alt := '[]'::jsonb;

    IF v_cpid IS NULL THEN
      -- #1 de-para (fornecedor_cnpj + cProd) — exata, auto-marca
      SELECT pr.id, pr.nome, pr.codigo, pr.estoque_atual INTO p
        FROM erp_produto_depara_fornecedor d JOIN erp_produtos pr ON pr.id = d.produto_id
       WHERE d.company_id = v_company AND d.fornecedor_cnpj = v_cnpj AND d.codigo_fornecedor = r.codigo_produto
       LIMIT 1;
      IF FOUND THEN
        v_sug := jsonb_build_object('produto_id',p.id,'nome',p.nome,'codigo',p.codigo,'estoque_atual',p.estoque_atual,
                   'criterio','depara','confianca','exata','score',1.0); v_auto := true;
      END IF;
      -- #2 EAN (cEAN = codigo_barras) — exata, auto-marca
      IF v_sug IS NULL AND v_ean IS NOT NULL THEN
        SELECT pr.id, pr.nome, pr.codigo, pr.estoque_atual INTO p FROM erp_produtos pr
          WHERE pr.company_id = v_company AND pr.ativo
            AND NULLIF(regexp_replace(COALESCE(pr.codigo_barras,''),'\D','','g'),'') = v_ean
          ORDER BY pr.updated_at DESC LIMIT 1;
        IF FOUND THEN
          v_sug := jsonb_build_object('produto_id',p.id,'nome',p.nome,'codigo',p.codigo,'estoque_atual',p.estoque_atual,
                     'criterio','ean','confianca','exata','score',1.0); v_auto := true;
        END IF;
      END IF;
      -- #3 cProd = erp_produtos.codigo — alta, sugere (não auto)
      IF v_sug IS NULL AND NULLIF(btrim(r.codigo_produto),'') IS NOT NULL THEN
        SELECT pr.id, pr.nome, pr.codigo, pr.estoque_atual INTO p FROM erp_produtos pr
          WHERE pr.company_id = v_company AND pr.ativo
            AND upper(btrim(pr.codigo)) = upper(btrim(r.codigo_produto))
          ORDER BY pr.updated_at DESC LIMIT 1;
        IF FOUND THEN
          v_sug := jsonb_build_object('produto_id',p.id,'nome',p.nome,'codigo',p.codigo,'estoque_atual',p.estoque_atual,
                     'criterio','codigo','confianca','alta','score',0.9);
        END IF;
      END IF;
      -- #4/#5 NCM + descrição (trigram) — sugere. Prioriza mesmo NCM (categoria certa).
      IF v_sug IS NULL AND NULLIF(btrim(COALESCE(r.descricao,'')),'') IS NOT NULL THEN
        SELECT pr.id, pr.nome, pr.codigo, pr.estoque_atual,
               similarity(pr.nome, r.descricao) AS sc, (pr.ncm = r.ncm) AS mncm
          INTO p FROM erp_produtos pr
          WHERE pr.company_id = v_company AND pr.ativo
            AND (pr.ncm = r.ncm OR similarity(pr.nome, r.descricao) >= 0.20)
          ORDER BY (pr.ncm = r.ncm) DESC, similarity(pr.nome, r.descricao) DESC LIMIT 1;
        IF FOUND AND (p.mncm OR p.sc >= 0.25) THEN
          v_sug := jsonb_build_object('produto_id',p.id,'nome',p.nome,'codigo',p.codigo,'estoque_atual',p.estoque_atual,
                     'criterio', CASE WHEN p.mncm THEN 'ncm_descricao' ELSE 'descricao' END,
                     'confianca', CASE WHEN p.mncm AND p.sc >= 0.30 THEN 'media'
                                       WHEN p.mncm THEN 'baixa'
                                       WHEN p.sc >= 0.40 THEN 'media' ELSE 'baixa' END,
                     'score', round(p.sc::numeric, 2));
        END IF;
      END IF;
      -- alternativas: até 3 (mesmo NCM / trigram), fora a sugestão
      SELECT COALESCE(jsonb_agg(a), '[]'::jsonb) INTO v_alt FROM (
        SELECT jsonb_build_object('produto_id',pr.id,'nome',pr.nome,'codigo',pr.codigo,
                 'score', round(similarity(pr.nome, COALESCE(r.descricao,''))::numeric,2),
                 'mesmo_ncm', (pr.ncm = r.ncm)) AS a
        FROM erp_produtos pr
        WHERE pr.company_id = v_company AND pr.ativo
          AND (pr.ncm = r.ncm OR similarity(pr.nome, COALESCE(r.descricao,'')) >= 0.25)
          AND (v_sug IS NULL OR pr.id <> (v_sug->>'produto_id')::uuid)
        ORDER BY (pr.ncm = r.ncm) DESC, similarity(pr.nome, COALESCE(r.descricao,'')) DESC
        LIMIT 3
      ) t;
    END IF;

    v_entra := fn_estoque_cfop_entra(v_company, r.cfop);
    v_out := v_out || jsonb_build_object(
      'item_id', r.id, 'numero_item', r.numero_item, 'codigo_produto', r.codigo_produto,
      'descricao', r.descricao, 'ncm', r.ncm, 'cfop', r.cfop,
      'quantidade', r.quantidade, 'valor_unitario', r.valor_unitario, 'codigo_barras', v_ean,
      'produto_id', v_cpid, 'produto_nome', v_cnome, 'vinculo_origem', v_corigem, 'entra_estoque', v_entra,
      'sugestao', v_sug, 'auto_exato', v_auto, 'alternativas', COALESCE(v_alt,'[]'::jsonb)
    );
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'itens', v_out);
END $function$;

-- ── 3) fn_nfe_item_criar_produto — item vira produto (herda EAN/NCM/custo), vincula e aprende ──
CREATE OR REPLACE FUNCTION public.fn_nfe_item_criar_produto(p_item_id uuid, p_dados jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record; v_company uuid; v_codigo text; v_dados jsonb; v_res jsonb; v_novo uuid;
BEGIN
  SELECT i.*, n.company_id AS n_company
    INTO r FROM erp_nfe_recebidas_itens i JOIN erp_nfe_recebidas n ON n.id = i.nfe_recebida_id
   WHERE i.id = p_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'item nao encontrado'); END IF;
  v_company := r.n_company;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem permissao'); END IF;
  IF r.produto_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'item ja vinculado', 'produto_id', r.produto_id); END IF;

  -- código do produto: usa o passado, senão o cProd; evita colisão com código já existente na empresa
  v_codigo := COALESCE(NULLIF(btrim(p_dados->>'codigo'),''), NULLIF(btrim(r.codigo_produto),''),
                       'NF-' || left(replace(p_item_id::text,'-',''), 8));
  IF EXISTS (SELECT 1 FROM erp_produtos WHERE company_id = v_company AND upper(btrim(codigo)) = upper(btrim(v_codigo))) THEN
    v_codigo := v_codigo || '-' || left(replace(p_item_id::text,'-',''), 4);
  END IF;

  v_dados := jsonb_build_object(
    'codigo', v_codigo,
    'nome', COALESCE(NULLIF(btrim(p_dados->>'nome'),''), NULLIF(btrim(r.descricao),''), v_codigo),
    'unidade', COALESCE(NULLIF(btrim(p_dados->>'unidade'),''), NULLIF(btrim(r.unidade),''), 'UN'),
    'tipo_item_sped', COALESCE(NULLIF(btrim(p_dados->>'tipo_item_sped'),''), '00'),
    'ncm', COALESCE(NULLIF(btrim(p_dados->>'ncm'),''), r.ncm),
    'origem', COALESCE(NULLIF(btrim(p_dados->>'origem'),''), '0')
  );

  -- cria via função canônica (RD-26 — sem INSERT direto)
  v_res := public.fn_erp_produto_salvar(v_company, v_dados, NULL);
  IF NOT (v_res->>'ok')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_criou_produto', 'detalhe', v_res); END IF;
  v_novo := (v_res->>'id')::uuid;

  -- enriquece o que a função canônica não cobre: EAN e custo (base do custo médio)
  UPDATE erp_produtos
     SET codigo_barras = COALESCE(NULLIF(regexp_replace(COALESCE(r.codigo_barras,''),'\D','','g'),''), codigo_barras),
         preco_custo    = COALESCE(r.valor_unitario, preco_custo),
         updated_at     = now()
   WHERE id = v_novo AND company_id = v_company;

  -- vincula o item + grava a de-para (reusa a função que já aprende)
  PERFORM public.fn_nfe_item_vincular(p_item_id, v_novo, true);

  RETURN jsonb_build_object('ok', true, 'produto_id', v_novo, 'item_id', p_item_id, 'codigo', v_codigo, 'criado', true);
END $function$;
REVOKE ALL ON FUNCTION public.fn_nfe_item_criar_produto(uuid, jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_nfe_item_criar_produto(uuid, jsonb) TO authenticated, service_role;
