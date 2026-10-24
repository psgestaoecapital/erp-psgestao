-- Viagem · indicadores (auditor 24/10, gap "Indicadores da viagem" · desenvolvedor_4_g, faixa 52).
-- Só leitura e só aditivo: uma função nova que lê a MESMA fonte do Resultado da obra (v_viagem_custo_obra →
-- v_obra_resultado.custo_viagens), então todo indicador sai da conta que já está no GE (RD-35). Nada existente muda.
--
--   Por obra (viagens não canceladas, todas as datas — igual ao Resultado):
--     custo de viagem ÷ m² executado (Σ quantidade_medida dos itens em m² do escopo da obra);
--     custo ÷ km     → km atribuído à obra = km da viagem × (parte da obra no custo da viagem);
--     custo ÷ dia    → dias da viagem da equipe (volta − saída + 1) × a mesma parte;
--     % do orçado    → custo de viagem ÷ custo previsto da obra (v_obra_resultado.custo_previsto); acima do limite
--                      (p_limite_pct, padrão 5%) a obra entra em alerta.
--   Por rota (origem → destino das viagens FECHADAS): nº de viagens, custo médio, km médio, dias médios, custo/km,
--     custo/dia e a última viagem — a base para orçar a próxima mobilização.
--   confere: o custo de viagem de cada obra = o do Resultado (1:1).
CREATE OR REPLACE FUNCTION public.fn_viagem_indicadores(p_company_id uuid, p_obra_id uuid DEFAULT NULL, p_limite_pct numeric DEFAULT 5)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  WITH vg AS (
    SELECT v.id, v.company_id, v.status, v.periodo_inicio,
           btrim(COALESCE(v.origem, '')) AS origem, btrim(COALESCE(v.destino, '')) AS destino,
           (v.periodo_fim - v.periodo_inicio + 1) AS dias,
           CASE WHEN v.km_inicial IS NOT NULL AND v.km_final IS NOT NULL AND v.km_final >= v.km_inicial
                THEN v.km_final - v.km_inicial END AS km
      FROM public.erp_viagem v
     WHERE v.company_id = p_company_id AND v.excluido_em IS NULL AND v.status <> 'cancelada'
  ),
  co AS (
    SELECT c.viagem_id, c.obra_id, c.custo_total,
           sum(c.custo_total) OVER (PARTITION BY c.viagem_id) AS custo_viagem
      FROM public.v_viagem_custo_obra c JOIN vg ON vg.id = c.viagem_id
  ),
  parte AS (
    SELECT co.obra_id, co.viagem_id, co.custo_total, vg.km, vg.dias,
           CASE WHEN co.custo_viagem > 0 THEN co.custo_total / co.custo_viagem ELSE 0 END AS fator
      FROM co JOIN vg ON vg.id = co.viagem_id
  ),
  obra AS (
    SELECT p.obra_id,
           count(DISTINCT p.viagem_id) AS viagens,
           round(sum(p.custo_total), 2) AS custo_viagens,
           round(sum(p.km * p.fator), 1) AS km_atribuido,
           round(sum(p.custo_total) FILTER (WHERE p.km IS NOT NULL), 2) AS custo_com_km,
           round(sum(p.dias * p.fator), 2) AS dias_atribuidos
      FROM parte p
     GROUP BY p.obra_id
  ),
  m2 AS (
    SELECT i.obra_id, sum(i.quantidade_medida) AS m2_executado
      FROM public.projetos_obra_item i
     WHERE i.company_id = p_company_id AND i.excluido_em IS NULL AND lower(btrim(COALESCE(i.unidade, ''))) IN ('m2', 'm²')
     GROUP BY i.obra_id
  ),
  ind AS (
    SELECT o.id AS obra_id, o.numero, o.nome,
           ob.viagens, ob.custo_viagens, ob.km_atribuido, ob.dias_atribuidos,
           COALESCE(m2.m2_executado, 0) AS m2_executado,
           COALESCE(r.custo_previsto, 0) AS custo_orcado,
           COALESCE(r.custo_viagens, 0) AS custo_no_resultado,
           CASE WHEN m2.m2_executado > 0 THEN round(ob.custo_viagens / m2.m2_executado, 2) END AS custo_m2,
           CASE WHEN ob.km_atribuido > 0 THEN round(ob.custo_com_km / ob.km_atribuido, 2) END AS custo_km,
           CASE WHEN ob.dias_atribuidos > 0 THEN round(ob.custo_viagens / ob.dias_atribuidos, 2) END AS custo_dia,
           CASE WHEN r.custo_previsto > 0 THEN round(ob.custo_viagens * 100 / r.custo_previsto, 2) END AS pct_orcado
      FROM obra ob
      JOIN public.projetos_obras o ON o.id = ob.obra_id AND o.company_id = p_company_id
      LEFT JOIN m2 ON m2.obra_id = ob.obra_id
      LEFT JOIN public.v_obra_resultado r ON r.obra_id = ob.obra_id
     WHERE p_obra_id IS NULL OR ob.obra_id = p_obra_id
  ),
  rota AS (
    SELECT vg.origem, vg.destino,
           count(*) AS viagens,
           round(avg(t.custo), 2) AS custo_medio,
           round(avg(vg.km), 1) AS km_medio,
           round(avg(vg.dias), 1) AS dias_medio,
           CASE WHEN sum(vg.km) > 0 THEN round(sum(t.custo) FILTER (WHERE vg.km IS NOT NULL) / sum(vg.km), 2) END AS custo_km,
           round(sum(t.custo) / sum(vg.dias), 2) AS custo_dia,
           max(vg.periodo_inicio) AS ultima
      FROM vg
      JOIN (SELECT viagem_id, sum(custo_total) AS custo FROM co GROUP BY viagem_id) t ON t.viagem_id = vg.id
     WHERE vg.status = 'fechada' AND vg.origem <> '' AND vg.destino <> ''
       AND (p_obra_id IS NULL OR EXISTS (SELECT 1 FROM co WHERE co.viagem_id = vg.id AND co.obra_id = p_obra_id))
     GROUP BY vg.origem, vg.destino
  )
  SELECT jsonb_build_object(
    'company_id', p_company_id, 'obra_id', p_obra_id, 'limite_pct', COALESCE(p_limite_pct, 5),
    'obras', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'obra_id', i.obra_id, 'numero', i.numero, 'nome', i.nome, 'viagens', i.viagens,
        'custo_viagens', i.custo_viagens, 'custo_no_resultado', i.custo_no_resultado,
        'confere', i.custo_viagens = i.custo_no_resultado,
        'm2_executado', i.m2_executado, 'custo_m2', i.custo_m2,
        'km_atribuido', i.km_atribuido, 'custo_km', i.custo_km,
        'dias_equipe', i.dias_atribuidos, 'custo_dia', i.custo_dia,
        'custo_orcado', i.custo_orcado, 'pct_orcado', i.pct_orcado,
        'alerta', COALESCE(i.pct_orcado > COALESCE(p_limite_pct, 5), false))
      ORDER BY i.pct_orcado DESC NULLS LAST, i.custo_viagens DESC) FROM ind i), '[]'::jsonb),
    'rotas', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'origem', r.origem, 'destino', r.destino, 'viagens', r.viagens, 'custo_medio', r.custo_medio,
        'km_medio', r.km_medio, 'dias_medio', r.dias_medio, 'custo_km', r.custo_km, 'custo_dia', r.custo_dia,
        'ultima', r.ultima) ORDER BY r.viagens DESC, r.ultima DESC) FROM rota r), '[]'::jsonb),
    'alertas', COALESCE((SELECT count(*) FROM ind i WHERE i.pct_orcado > COALESCE(p_limite_pct, 5)), 0),
    'confere', COALESCE((SELECT bool_and(i.custo_viagens = i.custo_no_resultado) FROM ind i), true)
  )
$function$;
REVOKE ALL ON FUNCTION public.fn_viagem_indicadores(uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_viagem_indicadores(uuid, uuid, numeric) TO authenticated, service_role;

-- "?" dos indicadores (RD-95), em linguagem de quem está na estrada
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/viagens', 'hub_construcao', 'publicado'
FROM (VALUES
  ('projetos.viagem.ind_limite', 'Indicadores', 'Alerta acima de', 'O percentual do custo previsto da obra que a viagem pode gastar antes de acender o alerta. Padrão: 5%.', 'Avisa cedo a obra em que o deslocamento está comendo a margem.', '5%', 'Pôr 0: toda obra com viagem entra em alerta.', 40),
  ('projetos.viagem.ind_custo_m2', 'Indicadores', 'Viagem por m²', 'Calculado: custo de viagem da obra ÷ m² já executado (medido).', 'Mostra quanto o deslocamento pesa em cada m² entregue; serve para comparar obras e orçar a próxima.', 'R$ 0,88 por m²', 'Obra sem medição em m²: o número não aparece até a primeira medição.', 41),
  ('projetos.viagem.ind_custo_km', 'Indicadores', 'Viagem por km', 'Calculado: custo de viagem da obra ÷ km rodado para ela (o km da viagem dividido na mesma proporção do custo).', 'Compara o deslocamento entre obras e veículos.', 'R$ 3,42 por km', 'Viagem sem km inicial ou final: ela fica fora desta conta.', 42),
  ('projetos.viagem.ind_custo_dia', 'Indicadores', 'Viagem por dia de equipe', 'Calculado: custo de viagem da obra ÷ dias da equipe na estrada (da saída até a volta, contando os dois dias).', 'Mostra o custo diário de manter a equipe fora; ajuda a decidir entre ir e voltar ou pernoitar.', 'R$ 328,02 por dia', 'Datas de saída e volta trocadas ou erradas mudam a conta.', 43),
  ('projetos.viagem.ind_pct_orcado', 'Indicadores', '% do orçado', 'Calculado: custo de viagem da obra ÷ custo previsto da obra.', 'Acima do limite escolhido, a obra fica em alerta.', '3,34% do custo previsto', 'Obra sem itens de custo previsto: o percentual não aparece.', 44),
  ('projetos.viagem.ind_rota', 'Indicadores', 'Histórico por rota', 'Calculado: viagens fechadas agrupadas por origem → destino, com custo médio, km médio, dias médios, custo por km e por dia.', 'Base para orçar a mobilização da próxima obra na mesma região.', 'Chapecó → Concórdia: 2 viagens, R$ 1.722,20 em média', 'Escrever a mesma cidade de jeitos diferentes separa a rota em duas.', 45)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
