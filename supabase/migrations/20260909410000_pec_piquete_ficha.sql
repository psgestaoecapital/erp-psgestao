-- ============================================================
-- Agro · Ficha do Piquete (P2 do SPEC "Ficha do Piquete") — historico de ocupacao + indicadores
-- que dependem SO de movimentacao. RD-26: nada de tabela nova de ocupacao — tudo derivado de
-- erp_pec_movimentacao. RD-51: indicador sem dado devolve NULL (nunca 0) — a tela diz "falta dado".
--
-- Decisao do CEO (09/09):
--  - (a) a saida de uma passagem = quando o ULTIMO animal daquela entrada deixou o piquete;
--  - saida PARCIAL vira FATO na linha ("93 entraram · 60 sairam em 12/05 · 33 em 28/07"), nao media;
--  - indicadores de lotacao/ocupacao usam ponderacao por ANIMAL-DIA (mais exato), nao a passagem.
--
-- "Passagem" = grupo de movimentacao que entrou (area_destino_id = piquete). Entrada = data do grupo.
-- Cada animal sai quando sua PROXIMA movimentacao (por data) tem area_origem_id = piquete; se nao ha,
-- o animal ainda esta la. Estornadas/deletadas ficam de fora (nao aconteceram de fato · RD-55).
--
-- Peso (GMD, ganho/ha, ganho/lote) e custo/margem ficam NULL com aviso ate P3 (pesagem) e P4 (custo).
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_pec_piquete_ficha(
  p_company_id uuid,
  p_area_id uuid,
  p_de date DEFAULT NULL::date,
  p_ate date DEFAULT NULL::date
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_area record;
  v_out jsonb;
  v_ini date;
  v_fim date;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;

  SELECT a.id, a.nome, a.tipo, a.area_ha, a.capacidade_ua, a.ativo, f.nome AS forrageira
    INTO v_area
  FROM erp_pec_area a
  LEFT JOIN erp_pec_forrageira f ON f.id = a.forrageira_id
  WHERE a.id = p_area_id AND a.company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Area nao encontrada');
  END IF;

  v_fim := COALESCE(p_ate, CURRENT_DATE);

  WITH mov AS (
    SELECT m.animal_id, m.data, m.created_at, m.grupo_id, m.area_origem_id, m.area_destino_id
    FROM erp_pec_movimentacao m
    WHERE m.company_id = p_company_id
      AND m.animal_id IS NOT NULL AND m.estornada = false AND m.deleted_at IS NULL
      AND (m.area_origem_id = p_area_id OR m.area_destino_id = p_area_id)
  ),
  ordered AS (
    SELECT o.*,
      lead(o.data)           OVER (PARTITION BY o.animal_id ORDER BY o.data, o.created_at) AS next_data,
      lead(o.area_origem_id) OVER (PARTITION BY o.animal_id ORDER BY o.data, o.created_at) AS next_origem
    FROM mov o
  ),
  -- um intervalo por ENTRADA do animal na area; saiu = proxima mov SE for saida desta area
  intervalos AS (
    SELECT o.animal_id, o.grupo_id, o.data AS entrou,
           CASE WHEN o.next_origem = p_area_id THEN o.next_data ELSE NULL END AS saiu
    FROM ordered o
    WHERE o.area_destino_id = p_area_id
      AND (p_de IS NULL OR o.data >= p_de)
      AND o.data <= v_fim
  ),
  -- PASSAGENS: por grupo de entrada. Saidas parciais como FATO (agrupadas por data).
  passagens AS (
    SELECT i.grupo_id,
           min(i.entrou) AS entrada,
           count(*) AS animais,
           count(*) FILTER (WHERE i.saiu IS NULL) AS ainda,
           max(i.saiu) AS ultima_saida,
           (COALESCE(max(i.saiu), v_fim) - min(i.entrou)) AS dias,
           (SELECT jsonb_agg(jsonb_build_object('data', s.d, 'n', s.n) ORDER BY s.d)
              FROM (SELECT i2.saiu AS d, count(*) AS n FROM intervalos i2
                    WHERE i2.grupo_id = i.grupo_id AND i2.saiu IS NOT NULL GROUP BY i2.saiu) s) AS saidas_parciais
    FROM intervalos i
    GROUP BY i.grupo_id
  ),
  -- OCUPACAO nivel-area por varredura de eventos (+1 entra, -1 sai).
  -- Still-there NAO emite -1 (o animal segue ocupando ate o fim do periodo). A sentinela em v_fim
  -- (delta 0) fecha o ultimo segmento ocupado para a medicao por lead(d).
  eventos AS (
    SELECT entrou AS d, 1 AS delta FROM intervalos
    UNION ALL
    SELECT saiu AS d, -1 AS delta FROM intervalos WHERE saiu IS NOT NULL AND saiu <= v_fim
    UNION ALL
    SELECT v_fim AS d, 0 AS delta
  ),
  ev AS (
    SELECT d, sum(delta) AS delta FROM eventos GROUP BY d
  ),
  sweep AS (
    SELECT d,
           sum(delta) OVER (ORDER BY d) AS cnt,
           lead(d) OVER (ORDER BY d) AS prox
    FROM ev
  ),
  ocup AS (
    SELECT
      COALESCE(sum(CASE WHEN cnt > 0 AND prox IS NOT NULL THEN (prox - d) END), 0)::numeric AS dias_ocupado,
      COALESCE(sum(CASE WHEN cnt = 0 AND prox IS NOT NULL THEN (prox - d) END), 0)::numeric AS dias_descanso,
      min(d) AS primeiro, max(d) AS ultimo
    FROM sweep
  ),
  adia AS (
    SELECT
      COALESCE(sum(COALESCE(saiu, v_fim) - entrou), 0)::numeric AS animal_dias,
      avg(COALESCE(saiu, v_fim) - entrou)::numeric AS permanencia_media,
      (SELECT count(*) FROM passagens) AS rotacoes
    FROM intervalos
  )
  SELECT jsonb_build_object(
    'ok', true,
    'cabecalho', jsonb_build_object(
      'id', v_area.id, 'nome', v_area.nome, 'tipo', v_area.tipo,
      'area_ha', v_area.area_ha, 'capacidade_ua', v_area.capacidade_ua,
      'forrageira', v_area.forrageira, 'ativo', v_area.ativo,
      'animais_agora', (SELECT count(*) FROM erp_pec_animal
                         WHERE company_id = p_company_id AND area_atual_id = p_area_id AND status = 'ativo'),
      'cabecas_ha_agora', CASE WHEN COALESCE(v_area.area_ha,0) > 0
        THEN round((SELECT count(*) FROM erp_pec_animal WHERE company_id = p_company_id AND area_atual_id = p_area_id AND status = 'ativo')::numeric / v_area.area_ha, 2)
        ELSE NULL END
    ),
    'passagens', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'grupo_id', grupo_id, 'entrada', entrada, 'ultima_saida', ultima_saida,
        'dias', dias, 'animais', animais, 'ainda_no_piquete', ainda,
        'saidas_parciais', saidas_parciais,
        'parcial', (ainda > 0 AND ainda < animais) OR (saidas_parciais IS NOT NULL AND jsonb_array_length(saidas_parciais) > 1)
      ) ORDER BY entrada DESC) FROM passagens), '[]'::jsonb),
    'indicadores', (SELECT jsonb_build_object(
        'permanencia_media_dias', round(a.permanencia_media, 1),
        'rotacoes', a.rotacoes,
        'animal_dias', a.animal_dias,
        'dias_ocupado', o.dias_ocupado,
        'dias_descanso', o.dias_descanso,
        'taxa_ocupacao_pct', CASE WHEN (o.dias_ocupado + o.dias_descanso) > 0
            THEN round(100 * o.dias_ocupado / (o.dias_ocupado + o.dias_descanso), 1) ELSE NULL END,
        'lotacao_media_cabecas_ha', CASE WHEN COALESCE(v_area.area_ha,0) > 0 AND (o.ultimo - o.primeiro) > 0
            THEN round(a.animal_dias / v_area.area_ha / (o.ultimo - o.primeiro), 2) ELSE NULL END,
        -- P3 (pesagem) e P4 (custo): NULL com aviso, nunca 0
        'gmd_kg_dia', NULL, 'ganho_arroba_ha', NULL, 'ganho_lote', NULL,
        'custo_periodo', NULL, 'custo_arroba', NULL, 'margem_ha', NULL
      ) FROM adia a, ocup o),
    'avisos', jsonb_build_object(
      'pesagem', 'GMD e ganho por hectare dependem de pesagens — nenhuma registrada neste piquete.',
      'custo', 'Custo e margem por hectare dependem de custos lancados — nenhum neste piquete.'
    ),
    'periodo', jsonb_build_object('de', p_de, 'ate', v_fim)
  ) INTO v_out;

  RETURN v_out;
END $function$;
