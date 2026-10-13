-- Importar EPIs do estoque existente (multi-fonte) para "Meus EPIs".
-- Cross-módulo read-only: alimenta epi_catalogo a partir do estoque que a empresa JÁ tem em outra área
-- (GE = erp_produtos; Indústria/ATAK = ind_atak_fato domínio 'embalagem' + saldo do domínio 'estoque'),
-- com seleção do usuário (há falsos positivos, ex.: "MÁSCARA SUÍNA"). RD-26 (não cria catálogo novo),
-- RD-51 (dado real), RD-52 (fonte única = epi_catalogo). Pilar 2: tudo filtra company_id.
--
-- ⚠️ RD-51 / §6 do SPEC: em dados reais da Frioeste, Tipo_produto='AL' (almoxarifado) e Cod_divisao1='50'
-- NÃO são marcadores confiáveis de EPI — inundam com válvulas, rolamentos, parafusos, etiquetas. O sinal
-- honesto de EPI é a KEYWORD no nome. Por isso "provável EPI" = keyword; o toggle "mostrar todos" abre o
-- resto do estoque (com busca) pro usuário achar o que a heurística não pegou. (Confirmar com o Jian se há
-- uma divisão/almoxarifado canônico de EPI; se houver, dá pra tornar o filtro exato depois.)

-- ---------------------------------------------------------------------------
-- 0) Helper: categoria (slug de epi_categoria) sugerida a partir do nome do produto. IMMUTABLE.
CREATE OR REPLACE FUNCTION public.fn_epi_slug_por_nome(p_nome text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_nome ~* 'luva'                               THEN 'luva'
    WHEN p_nome ~* '(óculos|oculos)'                    THEN 'oculos'
    WHEN p_nome ~* 'facial'                             THEN 'protetor-facial'
    WHEN p_nome ~* '(auricular|abafador|protetor auditivo)' THEN 'protetor-auricular'
    WHEN p_nome ~* '(máscara|mascara|respirad)'         THEN 'mascara'
    WHEN p_nome ~* '(capacete|carneira)'                THEN 'capacete'
    WHEN p_nome ~* 'avental'                            THEN 'avental'
    WHEN p_nome ~* 'perneira'                           THEN 'perneira'
    WHEN p_nome ~* '(\ybota(s|ina)?\y|calçad|calcad|sapato)' THEN 'calcado'
    WHEN p_nome ~* '(\ycinto|talabarte)'                THEN 'cinto-altura'
    WHEN p_nome ~* '(jaleco|touca|\ybra[çc]adeira|vestiment)' THEN 'vestimenta'
    ELSE 'outros'
  END;
$$;

-- ---------------------------------------------------------------------------
-- 1) Candidatos a EPI no estoque existente (multi-fonte, READ-ONLY). Não escreve nada.
--    p_somente_provaveis=true (default) → só os que batem keyword de EPI (lista enxuta de EPIs reais).
--    p_somente_provaveis=false          → todo o estoque (use p_busca pra achar algo específico).
CREATE OR REPLACE FUNCTION public.fn_epi_candidatos_estoque(
  p_company_ids uuid[],
  p_busca text DEFAULT NULL,
  p_somente_provaveis boolean DEFAULT true,
  p_limite int DEFAULT 500
)
RETURNS TABLE(
  fonte text, codigo text, nome text, saldo numeric,
  ca_sugerido text, categoria_slug text, provavel_epi boolean, ja_importado boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  -- keyword de EPI: sinais claros por substring + os ambíguos com fronteira de palavra (\y) pra não
  -- pegar "abraçadeira"/"botão"/"mangueira". "manga"/"mangote"/"braçad" ficam de fora (viram abraçadeira).
  v_kw text := '(luva|avental|óculos|oculos|máscara|mascara|respirad|capacete|carneira|auricular|abafador|touca|jaleco|perneira|talabarte|jugular|balaclava|protetor|calçad|calcad|\ybota(s|ina)?\y|\ybra[çc]adeira|\ycinto)';
  v_q text := NULLIF(btrim(coalesce(p_busca,'')), '');
BEGIN
  -- Pilar 2: só empresas do usuário (ou admin). Interseção defensiva.
  IF NOT (is_admin()) THEN
    p_company_ids := ARRAY(SELECT unnest(p_company_ids) INTERSECT SELECT get_user_company_ids());
  END IF;
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH
  -- ===== Fonte GE (erp_produtos) =====
  ge AS (
    SELECT
      'ge'::text AS fonte,
      pr.codigo::text AS codigo,
      pr.nome::text   AS nome,
      pr.estoque_atual AS saldo,
      (pr.categoria ILIKE '%epi%' OR pr.grupo ILIKE '%epi%' OR pr.subcategoria ILIKE '%epi%'
        OR pr.nome ~* v_kw) AS provavel
    FROM erp_produtos pr
    WHERE pr.company_id = ANY(p_company_ids) AND pr.ativo IS NOT FALSE
  ),
  -- ===== Fonte Indústria/ATAK — mestre de produtos (último por Cod_produto) =====
  emb AS (
    SELECT DISTINCT ON (f.raw->>'Cod_produto')
      f.raw->>'Cod_produto' AS cod,
      COALESCE(NULLIF(f.raw->>'Desc_produto_est',''), f.raw->>'Desc_produto_nf') AS nome,
      f.raw->>'Eh_comestivel' AS comest
    FROM ind_atak_fato f
    WHERE f.dominio='embalagem' AND f.company_id = ANY(p_company_ids)
    ORDER BY f.raw->>'Cod_produto', f.imported_at DESC
  ),
  -- saldo do domínio 'estoque': soma das classes na data mais recente por Cod_produto.
  est_raw AS (
    SELECT f.raw->>'Cod_produto' AS cod, (f.raw->>'Data_estoque') AS dt,
      ( coalesce((f.raw->>'Saldo_classe0')::numeric,0)+coalesce((f.raw->>'Saldo_classe1')::numeric,0)
      + coalesce((f.raw->>'Saldo_classe2')::numeric,0)+coalesce((f.raw->>'Saldo_classe3')::numeric,0)
      + coalesce((f.raw->>'Saldo_classe4')::numeric,0)+coalesce((f.raw->>'Saldo_classe5')::numeric,0)
      + coalesce((f.raw->>'Saldo_classe6')::numeric,0)+coalesce((f.raw->>'Saldo_classe7')::numeric,0)
      + coalesce((f.raw->>'Saldo_classe8')::numeric,0)+coalesce((f.raw->>'Saldo_classe9')::numeric,0) ) AS saldo_tot
    FROM ind_atak_fato f
    WHERE f.dominio='estoque' AND f.company_id = ANY(p_company_ids)
  ),
  est_max AS (SELECT cod, max(dt) AS dtmax FROM est_raw GROUP BY cod),
  est AS (
    SELECT r.cod, sum(r.saldo_tot) AS saldo
    FROM est_raw r JOIN est_max m ON m.cod=r.cod AND r.dt=m.dtmax
    GROUP BY r.cod
  ),
  atak AS (
    SELECT
      'atak'::text AS fonte, e.cod AS codigo, e.nome,
      es.saldo AS saldo,
      (e.nome ~* v_kw) AS provavel
    FROM emb e
    LEFT JOIN est es ON es.cod = e.cod
    WHERE COALESCE(e.comest,'N') <> 'S'      -- nunca comestível (carne)
      AND e.nome !~* 'su[íi]n'               -- exclui "máscara suína" e afins
      AND e.nome IS NOT NULL
  ),
  uni AS (
    SELECT ge.fonte, ge.codigo, ge.nome, ge.saldo, ge.provavel FROM ge
    UNION ALL
    SELECT atak.fonte, atak.codigo, atak.nome, atak.saldo, atak.provavel FROM atak
  )
  SELECT
    u.fonte, u.codigo, u.nome, u.saldo,
    -- CA embutido no nome (ex.: "CA: 36.942" → 36942)
    NULLIF(regexp_replace(coalesce((regexp_match(u.nome, 'CA[ :]*([0-9][0-9\.]*)'))[1],''), '\.', '', 'g'), '') AS ca_sugerido,
    fn_epi_slug_por_nome(u.nome) AS categoria_slug,
    u.provavel AS provavel_epi,
    EXISTS (
      SELECT 1 FROM epi_catalogo c
      WHERE c.company_id = ANY(p_company_ids) AND c.is_global IS NOT TRUE
        AND lower(btrim(c.modelo)) = lower(btrim(u.codigo))
    ) AS ja_importado
  FROM uni u
  WHERE (NOT p_somente_provaveis OR u.provavel)
    AND (v_q IS NULL OR u.nome ILIKE '%'||v_q||'%' OR u.codigo ILIKE '%'||v_q||'%')
  ORDER BY u.provavel DESC, u.nome
  LIMIT GREATEST(1, p_limite);
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_epi_candidatos_estoque(uuid[], text, boolean, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Importar selecionados → cria epi_catalogo (idempotente por company+modelo=código) e, quando há
--    saldo, cria/atualiza epi_estoque. Mantém 100% o cadastro manual (+ Novo EPI) intacto.
--    p_itens = [{fonte, codigo, nome, ca, saldo}] — o slug de categoria é derivado do nome no servidor
--    (não confia no cliente). ca_numero é NOT NULL → sem CA extraído usa 'A DEFINIR' (RD-51: não inventa).
CREATE OR REPLACE FUNCTION public.fn_epi_importar_estoque(p_company_id uuid, p_itens jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_item jsonb;
  v_cod text; v_nome text; v_ca text; v_fonte text; v_saldo numeric;
  v_cat_id uuid; v_cat_outros uuid; v_cat_id_final uuid;
  v_catalogo_id uuid;
  v_importados int := 0; v_pulados int := 0; v_com_saldo int := 0;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  SELECT id INTO v_cat_outros FROM epi_categoria WHERE slug='outros' LIMIT 1;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_itens,'[]'::jsonb)) LOOP
    v_cod   := NULLIF(btrim(v_item->>'codigo'), '');
    v_nome  := NULLIF(btrim(v_item->>'nome'), '');
    v_fonte := lower(coalesce(NULLIF(btrim(v_item->>'fonte'),''), 'estoque'));
    v_ca    := NULLIF(btrim(v_item->>'ca'), '');
    v_saldo := NULLIF(v_item->>'saldo','')::numeric;
    IF v_cod IS NULL OR v_nome IS NULL THEN CONTINUE; END IF;

    -- idempotência: já existe EPI próprio com esse código (modelo)?
    SELECT id INTO v_catalogo_id FROM epi_catalogo
    WHERE company_id = p_company_id AND is_global IS NOT TRUE
      AND lower(btrim(modelo)) = lower(v_cod)
    LIMIT 1;

    IF v_catalogo_id IS NULL THEN
      SELECT id INTO v_cat_id FROM epi_categoria WHERE slug = fn_epi_slug_por_nome(v_nome) LIMIT 1;
      v_cat_id_final := coalesce(v_cat_id, v_cat_outros);

      INSERT INTO epi_catalogo (
        company_id, is_global, categoria_id, nome, modelo,
        ca_numero, descartavel, ativo, observacoes)
      VALUES (
        p_company_id, false, v_cat_id_final, v_nome, v_cod,
        coalesce(v_ca, 'A DEFINIR'), false, true,
        'Importado do estoque '||v_fonte||' · cód '||v_cod)
      RETURNING id INTO v_catalogo_id;
      v_importados := v_importados + 1;
    ELSE
      v_pulados := v_pulados + 1;
    END IF;

    -- saldo (quando houver e > 0): cria/atualiza epi_estoque na localização "Estoque {fonte}".
    IF v_saldo IS NOT NULL AND v_saldo > 0 AND v_catalogo_id IS NOT NULL THEN
      INSERT INTO epi_estoque (company_id, catalogo_id, qtd_disponivel, qtd_reservada, localizacao, ativo)
      VALUES (p_company_id, v_catalogo_id, floor(v_saldo)::int, 0, 'Estoque '||v_fonte, true)
      ON CONFLICT (company_id, catalogo_id, localizacao)
      DO UPDATE SET qtd_disponivel = EXCLUDED.qtd_disponivel, updated_at = now();
      v_com_saldo := v_com_saldo + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'importados', v_importados, 'pulados', v_pulados, 'com_saldo', v_com_saldo);
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_epi_importar_estoque(uuid, jsonb) TO authenticated;
