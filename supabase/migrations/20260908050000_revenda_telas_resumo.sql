-- ============================================================
-- Enriquecer as telas de Preparacao e "O que comprar" (so leitura; nenhuma regra muda).
-- Duas RPCs de resumo, sem efeito colateral. RD-55: NAO corrige marca — so mostra as grafias.
-- Achado: 3 grafias de Volkswagen (VOLKSWAGEM/VOLKSWAGEN/VOLKWAGEN). O agrupamento e LITERAL
-- (upper+unaccent+btrim) — o numero de cada grupo e FATO. A similaridade trigram (pg_trgm) so
-- SUGERE, num aviso separado (grafias que parecem a mesma marca) — se errar, erra no aviso, nao
-- num total. Sem catalogo fechado, sem alterar cadastro.
-- ============================================================

-- ------------------------------------------------------------
-- fn_veic_preparacao_pendentes · cabecalho + veiculos com reparo previsto sem OS + empty state 2 niveis
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_veic_preparacao_pendentes(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_and record; v_mes record; v_pend jsonb; v_tot int; v_sem_vist int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- OS de preparacao em andamento (abertas, ainda sem custo)
  SELECT count(*) AS n,
         COALESCE(sum(COALESCE(NULLIF(o.total,0), COALESCE(o.valor_servico,0)+COALESCE(o.valor_materiais,0)+COALESCE(o.valor_deslocamento,0))),0) AS valor
    INTO v_and
    FROM erp_os o
   WHERE o.company_id = p_company_id AND o.veic_veiculo_id IS NOT NULL AND o.excluida = false
     AND o.status NOT IN ('cancelada','entregue','pronta');

  -- OS concluidas no mes
  SELECT count(*) AS n,
         COALESCE(sum(COALESCE(NULLIF(o.total,0), COALESCE(o.valor_servico,0)+COALESCE(o.valor_materiais,0)+COALESCE(o.valor_deslocamento,0))),0) AS valor
    INTO v_mes
    FROM erp_os o
   WHERE o.company_id = p_company_id AND o.veic_veiculo_id IS NOT NULL AND o.excluida = false
     AND o.status IN ('entregue','pronta') AND o.data_conclusao >= date_trunc('month', CURRENT_DATE);

  -- veiculos com vistoria concluida, itens em reparo/troca, e nenhuma OS aberta
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'previsto')::numeric DESC), '[]'::jsonb) INTO v_pend FROM (
    SELECT jsonb_build_object(
      'veiculo_id', v.id, 'placa', v.placa, 'marca', v.marca, 'modelo', v.modelo,
      'previsto', prev.previsto, 'vistoria_id', prev.vistoria_id
    ) AS x
    FROM veic_veiculo v
    JOIN LATERAL (
      SELECT vi.id AS vistoria_id,
             COALESCE(NULLIF((SELECT COALESCE(sum(r.gasto_previsto),0) FROM insp_resposta r
                              WHERE r.vistoria_id = vi.id AND r.estado IN ('reparo','troca')),0),
                      vi.previsao_total, 0) AS previsto,
             (SELECT count(*) FROM insp_resposta r WHERE r.vistoria_id = vi.id AND r.estado IN ('reparo','troca')) AS n_itens
        FROM insp_vistoria vi
       WHERE vi.alvo_tabela='veic_veiculo' AND vi.alvo_id = v.id AND vi.situacao='concluida'
       ORDER BY vi.concluida_em DESC NULLS LAST LIMIT 1
    ) prev ON true
    WHERE v.company_id = p_company_id AND v.deleted_at IS NULL
      AND prev.n_itens > 0
      AND NOT EXISTS (SELECT 1 FROM erp_os o WHERE o.veic_veiculo_id = v.id AND o.excluida=false
                        AND o.status NOT IN ('cancelada','entregue','pronta'))
  ) t;

  SELECT count(*) INTO v_tot FROM veic_veiculo WHERE company_id=p_company_id AND deleted_at IS NULL;
  SELECT count(*) INTO v_sem_vist FROM veic_veiculo v
   WHERE v.company_id=p_company_id AND v.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM insp_vistoria vi WHERE vi.alvo_tabela='veic_veiculo' AND vi.alvo_id=v.id AND vi.situacao='concluida');

  RETURN jsonb_build_object('ok', true,
    'em_andamento', jsonb_build_object('os', v_and.n, 'valor', v_and.valor),
    'concluidas_mes', jsonb_build_object('os', v_mes.n, 'valor', v_mes.valor),
    'aguardando_os', jsonb_build_object('veiculos', jsonb_array_length(v_pend), 'lista', v_pend),
    'total_veiculos', v_tot,
    'sem_vistoria', v_sem_vist);
END $function$;

-- ------------------------------------------------------------
-- fn_veic_patio_resumo · agrupa por marca LITERAL (upper+unaccent+btrim), capital, dias + vendas por modelo.
--   O numero de cada grupo e FATO — nunca depende de limiar (VOLKSWAGEM 2, VOLKSWAGEN 2, VOLKWAGEN 1).
--   'sugestoes_grafia' usa trigram SO PARA SUGERIR (aviso separado): grafias distintas que parecem a mesma
--   marca, com o total de veiculos e as placas para o link. Se a heuristica errar, erra num aviso, nao num
--   total. 'sem marca' e grupo proprio e nunca entra em sugestao. RD-55: so mostra, nao corrige o cadastro.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_veic_patio_resumo(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_grupos jsonb; v_sugestoes jsonb; v_tot int; v_cap numeric; v_vendas jsonb; v_vendas_tot int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT count(*), COALESCE(sum(valor_aquisicao),0) INTO v_tot, v_cap
    FROM veic_veiculo WHERE company_id=p_company_id AND deleted_at IS NULL;

  -- 1) grupos LITERAIS por marca normalizada (upper+unaccent+btrim). O numero exibido e FATO:
  --    VOLKSWAGEM 2, VOLKSWAGEN 2, VOLKWAGEN 1 — nunca depende de limiar. 'sem marca' e grupo proprio.
  SELECT jsonb_agg(g ORDER BY (g->>'n')::int DESC, g->>'nome') INTO v_grupos FROM (
    SELECT jsonb_build_object(
      'nome', CASE WHEN norm='' THEN 'sem marca' ELSE mode() WITHIN GROUP (ORDER BY marca_orig) END,
      'norm', norm,
      'n', count(*),
      'capital', COALESCE(sum(valor_aquisicao),0),
      'dias_medio', CASE WHEN count(data_entrada)>0 THEN round(avg(CURRENT_DATE - data_entrada))::int ELSE NULL END,
      'sem_marca', norm=''
    ) AS g
    FROM (
      SELECT marca AS marca_orig, valor_aquisicao, data_entrada, upper(unaccent(btrim(coalesce(marca,'')))) AS norm
      FROM veic_veiculo WHERE company_id=p_company_id AND deleted_at IS NULL
    ) veic
    GROUP BY norm
  ) t;

  -- 2) SUGESTOES de grafia (trigram, so pra SUGERIR): grafias distintas que parecem a mesma marca.
  --    Nunca altera o numero de nenhum grupo — vira aviso separado. RD-55: so mostra, o dono padroniza.
  WITH veic AS (
    SELECT id, placa, marca AS marca_orig, upper(unaccent(btrim(coalesce(marca,'')))) AS norm
    FROM veic_veiculo WHERE company_id=p_company_id AND deleted_at IS NULL
  ),
  marcas AS (SELECT DISTINCT norm FROM veic WHERE norm <> ''),
  edges AS (SELECT a.norm AS n1, b.norm AS n2 FROM marcas a JOIN marcas b ON a.norm <> b.norm AND similarity(a.norm, b.norm) >= 0.40),
  reach AS (
    WITH RECURSIVE r(src, node) AS (
      SELECT norm, norm FROM marcas UNION SELECT r.src, e.n2 FROM r JOIN edges e ON e.n1 = r.node)
    SELECT src, min(node) AS canonical FROM r GROUP BY src
  ),
  clusters AS (
    SELECT rc.canonical, v.id, v.placa, v.marca_orig, v.norm
    FROM veic v JOIN reach rc ON rc.src = v.norm  -- so norm<>'' (sem marca nao entra em sugestao)
  )
  SELECT COALESCE(jsonb_agg(s ORDER BY (s->>'veiculos')::int DESC), '[]'::jsonb) INTO v_sugestoes FROM (
    SELECT jsonb_build_object(
      'grafias', jsonb_agg(DISTINCT marca_orig),
      'veiculos', count(*),
      'placas', COALESCE(jsonb_agg(DISTINCT placa) FILTER (WHERE placa IS NOT NULL), '[]'::jsonb),
      'veiculo_ids', jsonb_agg(DISTINCT id)
    ) AS s
    FROM clusters
    GROUP BY canonical
    HAVING count(DISTINCT norm) > 1   -- so quando ha mais de uma grafia no mesmo cluster
  ) t;

  -- vendas por modelo (>= 2 vendas para afirmar media; abaixo disso so conta)
  SELECT count(*) INTO v_vendas_tot FROM veic_venda WHERE company_id=p_company_id AND deleted_at IS NULL AND situacao <> 'cancelada';
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'qtd')::int DESC, x->>'modelo'), '[]'::jsonb) INTO v_vendas FROM (
    SELECT jsonb_build_object(
      'modelo', mode() WITHIN GROUP (ORDER BY v.modelo),
      'qtd', count(*),
      'afirma_media', count(*) >= 2,
      'dias_medio', CASE WHEN count(*) >= 2 THEN round(avg(vv.data_venda - v.data_entrada)) ELSE NULL END,
      'margem_media', CASE WHEN count(*) >= 2 THEN round(avg(
          vv.valor_venda - COALESCE(v.valor_aquisicao,0)
          - COALESCE((SELECT sum(c.valor) FROM veic_custo c WHERE c.veiculo_id=v.id AND c.deleted_at IS NULL),0))) ELSE NULL END
    ) AS x
    FROM veic_venda vv JOIN veic_veiculo v ON v.id=vv.veiculo_id
    WHERE vv.company_id=p_company_id AND vv.deleted_at IS NULL AND vv.situacao <> 'cancelada'
      AND coalesce(btrim(v.modelo),'') <> ''
    GROUP BY upper(unaccent(btrim(coalesce(v.modelo,''))))
  ) t;

  RETURN jsonb_build_object('ok', true,
    'total_veiculos', v_tot, 'capital', v_cap,
    'marcas', COALESCE(v_grupos, '[]'::jsonb),
    'sugestoes_grafia', COALESCE(v_sugestoes, '[]'::jsonb),
    'vendas_total', v_vendas_tot,
    'vendas_por_modelo', v_vendas);
END $function$;
