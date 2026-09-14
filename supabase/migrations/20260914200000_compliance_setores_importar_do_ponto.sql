-- ============================================================
-- SST ③ (passo 1) · importar setores do ponto para prod_setor — genérico, com prévia e dedup
-- ============================================================
-- A cadeia do LTCAT é prod_setor → prod_posto (posto/função) → prod_posto_risco/epi. Hoje a
-- validadora tem 3 prod_setor e 1 prod_posto, enquanto o ponto (ind_ponto_dia.department) tem 27
-- setores reais. Sem os setores, a tela de LTCAT nasce pela metade (SPEC §4.1). Importa do ponto.
--
-- Genérico (qualquer tenant): lê os department distintos de ind_ponto_dia da empresa e cria em
-- prod_setor os que faltam. NADA chumbado. Dedup por nome NORMALIZADO (unaccent+lower+espaços),
-- como no fn_oficina_servico_criar — "DESOSSA" e "Desossa" não viram dois. RD-61: os existentes
-- ficam como estão (com seus vínculos); só INSERE os novos. Prévia antes (não importa em silêncio).

-- 1) Prévia: mostra os setores do ponto, marcando os que já existem (por nome normalizado).
CREATE OR REPLACE FUNCTION public.fn_compliance_setores_do_ponto_preview(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v jsonb; BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  WITH dep AS (
    SELECT btrim(department) AS nome, count(*) AS dias,
           unaccent(lower(btrim(regexp_replace(department, '\s+', ' ', 'g')))) AS norm
    FROM ind_ponto_dia
    WHERE company_id = p_company_id AND department IS NOT NULL AND btrim(department) <> ''
    GROUP BY 1, 3
  ),
  dep1 AS (  -- dedup entre os próprios departments por norma (fica o de mais dias)
    SELECT DISTINCT ON (norm) nome, dias, norm FROM dep ORDER BY norm, dias DESC
  ),
  existentes AS (
    SELECT unaccent(lower(btrim(regexp_replace(nome, '\s+', ' ', 'g')))) AS norm
    FROM prod_setor WHERE company_id = p_company_id AND COALESCE(ativo, true)
  )
  SELECT jsonb_build_object(
    'candidatos', COALESCE(jsonb_agg(jsonb_build_object('nome', d.nome, 'dias', d.dias,
                    'ja_existe', EXISTS (SELECT 1 FROM existentes e WHERE e.norm = d.norm)) ORDER BY d.nome), '[]'::jsonb),
    'resumo', jsonb_build_object(
      'no_ponto', (SELECT count(*) FROM dep1),
      'ja_cadastrados', (SELECT count(*) FROM dep1 d WHERE EXISTS (SELECT 1 FROM existentes e WHERE e.norm=d.norm)),
      'novos', (SELECT count(*) FROM dep1 d WHERE NOT EXISTS (SELECT 1 FROM existentes e WHERE e.norm=d.norm)),
      'ja_em_prod_setor', (SELECT count(*) FROM prod_setor WHERE company_id=p_company_id))
  ) INTO v FROM dep1 d;
  RETURN jsonb_build_object('ok', true) || v;
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_compliance_setores_do_ponto_preview(uuid) TO authenticated;

-- 2) Import: cria em prod_setor os nomes escolhidos (p_nomes) que ainda não existem. Se p_nomes
--    for NULL, importa todos os novos. Dedup normalizado. Resolve plant_id. Conta antes/depois.
CREATE OR REPLACE FUNCTION public.fn_compliance_setores_importar_do_ponto(p_company_id uuid, p_nomes text[] DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_plant uuid; v_antes int; v_depois int; v_base int; v_criados int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- plant_id (NOT NULL): reaproveita o da empresa; senão o do ponto. Sem planta → erro claro.
  v_plant := (SELECT plant_id FROM prod_setor WHERE company_id=p_company_id LIMIT 1);
  IF v_plant IS NULL THEN v_plant := (SELECT plant_id FROM ind_ponto_colaborador WHERE company_id=p_company_id AND plant_id IS NOT NULL LIMIT 1); END IF;
  IF v_plant IS NULL THEN v_plant := (SELECT plant_id FROM ind_ponto_dia WHERE company_id=p_company_id AND plant_id IS NOT NULL LIMIT 1); END IF;
  IF v_plant IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_planta'); END IF;

  SELECT count(*) INTO v_antes FROM prod_setor WHERE company_id=p_company_id;
  SELECT COALESCE(max(ordem),0) INTO v_base FROM prod_setor WHERE company_id=p_company_id;

  WITH dep AS (
    SELECT btrim(department) AS nome,
           unaccent(lower(btrim(regexp_replace(department, '\s+', ' ', 'g')))) AS norm,
           count(*) AS dias
    FROM ind_ponto_dia
    WHERE company_id=p_company_id AND department IS NOT NULL AND btrim(department) <> ''
      AND (p_nomes IS NULL OR btrim(department) = ANY(p_nomes))
    GROUP BY 1,2
  ),
  novos AS (
    SELECT DISTINCT ON (norm) nome, norm, dias FROM dep
    WHERE NOT EXISTS (SELECT 1 FROM prod_setor s WHERE s.company_id=p_company_id
                       AND unaccent(lower(btrim(regexp_replace(s.nome,'\s+',' ','g')))) = dep.norm)
    ORDER BY norm, dias DESC
  ),
  ins AS (
    INSERT INTO prod_setor (company_id, plant_id, nome, ordem, ativo)
    SELECT p_company_id, v_plant, n.nome, v_base + row_number() OVER (ORDER BY n.nome), true
    FROM novos n
    RETURNING 1
  )
  SELECT count(*) INTO v_criados FROM ins;

  SELECT count(*) INTO v_depois FROM prod_setor WHERE company_id=p_company_id;
  RETURN jsonb_build_object('ok', true, 'antes', v_antes, 'criados', v_criados,
    'ja_existiam', v_antes, 'depois', v_depois, 'plant_id', v_plant);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_compliance_setores_importar_do_ponto(uuid, text[]) TO authenticated;
