-- Hub · Viagens (tela 270) — comparativo CUSTO REAL de deslocamento × PREÇO DE MOBILIZAÇÃO do contrato do cliente
-- (decisão CEO 22/10, FC Pisos / BRF). Hoje os indicadores só têm o histórico por rota e o custo por m²/km/dia; não
-- existia o confronto "o que gastamos para mobilizar a equipe × o que o cliente paga de mobilização no contrato de
-- preços". Este arquivo:
--   1) estende fn_viagem_indicadores (SÓ ACRESCENTA campos ao JSON de cada obra — nenhuma coluna ou linha existente
--      muda): lê, para a obra, o preço de mobilização da tabela de preços ATIVA e VIGENTE do cliente da obra (item cujo
--      serviço fala em "mobiliza…"); devolve preco_mobilizacao, mobilizacao_tabela, mobilizacao_pct (custo real ÷ preço)
--      e mobilizacao_alerta (real acima do contratado). Quando o cliente não tem linha de mobilização, os campos vêm
--      nulos e a tela mostra estado vazio honesto (sem inventar número — RD-38).
--   2) semente da Construtora DEMO (só is_demo, idempotente ON CONFLICT): acrescenta a verba de mobilização ao contrato
--      do Frigorífico Oeste (…e0002) e do Residencial Vista Verde (…e0001), para o confronto aparecer na foto da DEMO.
--      Durabilidade entre resets fica a cargo das funções de semente (fn_demo_seed_construtora_obra_fc_piso /
--      fn_demo_seed_construtora_extras), que não são reescritas aqui para não arriscar o núcleo do banco de testes.
--   3) "?" (RD-95) dos campos novos.
-- RD-94.1: CREATE OR REPLACE de função existente (fn_viagem_indicadores) → via revisada. Faixa 52 (desenvolvedor_4_g).

-- ── 1) indicadores: + comparativo real × mobilização do contrato ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_viagem_indicadores(p_company_id uuid, p_obra_id uuid DEFAULT NULL::uuid, p_limite_pct numeric DEFAULT 5)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
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
           CASE WHEN r.custo_previsto > 0 THEN round(ob.custo_viagens * 100 / r.custo_previsto, 2) END AS pct_orcado,
           mob.preco AS preco_mobilizacao, mob.tabela_nome AS mobilizacao_tabela,
           CASE WHEN mob.preco > 0 THEN round(ob.custo_viagens * 100 / mob.preco, 1) END AS mobilizacao_pct,
           CASE WHEN mob.preco IS NOT NULL THEN COALESCE(ob.custo_viagens > mob.preco, false) END AS mobilizacao_alerta
      FROM obra ob
      JOIN public.projetos_obras o ON o.id = ob.obra_id AND o.company_id = p_company_id
      LEFT JOIN m2 ON m2.obra_id = ob.obra_id
      LEFT JOIN public.v_obra_resultado r ON r.obra_id = ob.obra_id
      -- preço de mobilização do contrato ATIVO e VIGENTE do cliente da obra (verba; a linha cujo serviço fala em
      -- "mobiliza…"). Band base (menor faixa) quando houver faixas. Não inventa quando o cliente não tem a linha.
      LEFT JOIN LATERAL (
        SELECT round(mi.preco_base, 2) AS preco, t.nome AS tabela_nome
          FROM public.erp_tabela_preco_cliente t
          JOIN public.erp_tabela_preco_item mi ON mi.tabela_id = t.id
         WHERE t.company_id = p_company_id AND o.cliente_id IS NOT NULL AND t.cliente_id = o.cliente_id
           AND t.ativo
           AND (t.vigencia_inicio IS NULL OR t.vigencia_inicio <= CURRENT_DATE)
           AND (t.vigencia_fim IS NULL OR t.vigencia_fim >= CURRENT_DATE)
           AND (mi.servico_nome ILIKE '%mobiliza%' OR mi.servico_ref ILIKE '%mobiliza%')
         ORDER BY t.vigencia_inicio DESC NULLS LAST, mi.faixa_de ASC NULLS FIRST, mi.preco_base ASC
         LIMIT 1
      ) mob ON true
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
        'preco_mobilizacao', i.preco_mobilizacao, 'mobilizacao_tabela', i.mobilizacao_tabela,
        'mobilizacao_pct', i.mobilizacao_pct, 'mobilizacao_alerta', i.mobilizacao_alerta,
        'alerta', COALESCE(i.pct_orcado > COALESCE(p_limite_pct, 5), false))
      ORDER BY i.pct_orcado DESC NULLS LAST, i.custo_viagens DESC) FROM ind i), '[]'::jsonb),
    'rotas', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'origem', r.origem, 'destino', r.destino, 'viagens', r.viagens, 'custo_medio', r.custo_medio,
        'km_medio', r.km_medio, 'dias_medio', r.dias_medio, 'custo_km', r.custo_km, 'custo_dia', r.custo_dia,
        'ultima', r.ultima) ORDER BY r.viagens DESC, r.ultima DESC) FROM rota r), '[]'::jsonb),
    'alertas', COALESCE((SELECT count(*) FROM ind i WHERE i.pct_orcado > COALESCE(p_limite_pct, 5)), 0),
    'mobilizacao_alertas', COALESCE((SELECT count(*) FROM ind i WHERE i.mobilizacao_alerta), 0),
    'confere', COALESCE((SELECT bool_and(i.custo_viagens = i.custo_no_resultado) FROM ind i), true)
  )
$function$;

-- ── 2) semente DEMO (idempotente): verba de mobilização no contrato dos clientes DEMO ──────────────────────────────
-- Só a empresa de demonstração fixa do Hub (006). Confronto na foto: FC real ≈ R$ 2.460,35 × verba R$ 3.200 (77% — dentro);
-- Vista Verde real ≈ R$ 984,05 × verba R$ 800 (123% — acima, dispara o alerta). Verba = preço fechado da mobilização.
INSERT INTO public.erp_tabela_preco_item (id, company_id, tabela_id, servico_ref, servico_nome, unidade, faixa_de, faixa_ate, preco_base, adicional)
VALUES
  ('b0700000-0000-4000-a000-00000e0b0002', 'b0700000-0000-4000-a000-000000000006', 'b0700000-0000-4000-a000-0000000e0002',
   'DEMO-FC-MOB', 'Mobilização e desmobilização de equipe', 'vb', 0, NULL, 3200.0000, false),
  ('b0700000-0000-4000-a000-00000e0b0001', 'b0700000-0000-4000-a000-000000000006', 'b0700000-0000-4000-a000-0000000e0001',
   'DEMO-MOB', 'Mobilização e desmobilização de equipe', 'vb', 0, NULL, 800.0000, false)
ON CONFLICT (id) DO NOTHING;

-- ── 3) "?" (RD-95) dos campos novos ────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/viagens', 'hub_construcao', 'publicado'
FROM (VALUES
  ('projetos.viagem.ind_mobilizacao', 'Indicadores', 'Mobilização (contrato)', 'Calculado: o preço de mobilização que o cliente paga no contrato de preços ativo da obra (a linha de "mobilização" da tabela de preços).', 'Mostra quanto o contrato cobre de mobilização, para comparar com o custo real de deslocamento da equipe.', 'R$ 3.200,00', 'Cliente sem linha de mobilização no contrato: o comparativo fica em branco até cadastrar a verba na tabela de preços.', 50),
  ('projetos.viagem.ind_mob_pct', 'Indicadores', 'Real ÷ mobilização', 'Calculado: custo real de viagem da obra dividido pelo preço de mobilização do contrato.', 'Abaixo de 100% o deslocamento coube na mobilização que o cliente paga; acima de 100% a obra gastou mais do que o contrato cobre.', '77% (dentro) · 123% (acima)', 'Comparar com o % do orçado: aqui a base é a mobilização do contrato, não o custo previsto da obra.', 51),
  ('projetos.viagem.ind_mob_alerta', 'Indicadores', 'Mobilização estourada', 'Calculado: aceso quando o custo real de deslocamento passou do preço de mobilização do contrato.', 'Avisa que a obra gastou mais para mobilizar a equipe do que o cliente paga de mobilização — margem de deslocamento no vermelho.', 'Real R$ 984 × contrato R$ 800', 'Ignorar o alerta: o excesso de mobilização sai da margem da obra.', 52),
  ('projetos.viagem.ge_titulos_conta', 'GE', 'Títulos no GE', 'Calculado: os títulos criados no contas a pagar quando a viagem foi lançada no GE (um por cupom/obra e situação).', 'Mostra o lançamento REAL no GE desta viagem, com a situação de cada título (pago pela empresa, a prazo, coberto pelo adiantamento, reembolso) e o valor.', 'Pago pela empresa · R$ 1.380,00', 'Procurar o título no financeiro sem conferir a situação: coberto pelo adiantamento já saiu no adiantamento, não é reembolso.', 53)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
