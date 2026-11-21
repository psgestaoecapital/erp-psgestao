-- Hub · Onda E (tela 318, /dashboard/projetos/obras/resultado) — Caixa da obra mês a mês.
-- Requisito do blueprint vivo (vertical 'hub_projetos', tela_num 318):
--   "Caixa da obra mês a mês: previsto, gasto, receita entrada (medições e vendas) e sobra ou falta."
-- Esta fatia entrega o REALIZADO mês a mês (entrada × saída × saldo do mês × saldo acumulado).
-- O "previsto" (desembolso previsto = cronograma × orçamento) vem da onda D (contrato de dados com o
-- desenvolvedor da agenda/cronograma) e entra numa fatia seguinte — por isso a linha fica 'parcial'.
--
-- Fonte do GASTO: as MESMAS 5 fontes de custo de v_obra_resultado_alocado, agora quebradas por mês, de modo
-- que a soma dos meses BATE com o total vitalício da obra (RD-38). Fonte da ENTRADA: medições aprovadas do
-- Hub (projetos_obra_medicao, por competência) + vendas vinculadas à obra (erp_pedidos, por data do pedido).
-- Linhas sem data caem num balde "Sem data" para que nada seja descartado e o total continue fechando.
--
-- Aditiva, só leitura (SECURITY DEFINER com escopo por empresa via get_user_company_ids), REVOKE anon.
-- Não altera nenhuma tabela nem dado de cliente. Code: code-desenvolvedor-3.

CREATE OR REPLACE FUNCTION public.fn_obra_caixa_mensal(p_obra_id uuid)
RETURNS TABLE(
  mes                text,
  mes_ordem          date,
  receita_medicao    numeric,
  receita_venda      numeric,
  entrada            numeric,
  custo_mao_obra     numeric,
  custo_rateio       numeric,
  custo_viagens      numeric,
  custo_contas_pagar numeric,
  custo_material     numeric,
  saida              numeric,
  saldo_mes          numeric,
  saldo_acumulado    numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH obra AS (
    -- Escopo por empresa: só a obra do próprio usuário (RLS via get_user_company_ids).
    SELECT o.id, o.company_id, o.centro_custo_id
      FROM public.projetos_obras o
     WHERE o.id = p_obra_id
       AND o.company_id IN (SELECT public.get_user_company_ids())
  ),
  -- ENTRADA: medições aprovadas do Hub (valor líquido quando houver retenção).
  med AS (
    SELECT date_trunc('month', m.competencia)::date AS mo,
           sum(COALESCE(m.valor_liquido, m.valor_total, 0)) AS v
      FROM public.projetos_obra_medicao m
      JOIN obra o ON o.id = m.obra_id
     WHERE m.excluido_em IS NULL AND m.status = 'aprovada'
     GROUP BY 1
  ),
  -- ENTRADA: vendas vinculadas à obra (pedidos não cancelados).
  ven AS (
    SELECT date_trunc('month', p.data_pedido)::date AS mo,
           sum(COALESCE(p.total, 0)) AS v
      FROM public.erp_pedidos p
      JOIN obra o ON o.id = p.obra_id
     WHERE COALESCE(p.status::text, '') NOT IN ('cancelado', 'cancelada')
     GROUP BY 1
  ),
  -- GASTO: CMV das vendas (mesma fonte/filtro de v_obra_resultado.custo_material).
  cmv AS (
    SELECT date_trunc('month', p.data_pedido)::date AS mo,
           sum(COALESCE(p.cmv, 0)) AS v
      FROM public.erp_pedidos p
      JOIN obra o ON o.id = p.obra_id
     WHERE COALESCE(p.status::text, '') NOT IN ('cancelado', 'cancelada')
     GROUP BY 1
  ),
  -- GASTO: mão de obra apontada na obra.
  mo AS (
    SELECT date_trunc('month', a.data)::date AS mo,
           sum(COALESCE(a.valor, 0)) AS v
      FROM public.projetos_obra_mao_obra_apontamento a
      JOIN obra o ON o.id = a.obra_id
     WHERE a.excluido_em IS NULL
     GROUP BY 1
  ),
  -- GASTO: custo fixo rateado para a obra.
  rt AS (
    SELECT date_trunc('month', r.competencia)::date AS mo,
           sum(COALESCE(r.valor, 0)) AS v
      FROM public.projetos_obra_rateio r
      JOIN obra o ON o.id = r.obra_id
     WHERE r.excluido_em IS NULL
     GROUP BY 1
  ),
  -- GASTO: viagens — custo_total (direto + rateado) de v_viagem_custo_obra, datado pelo 1º lançamento da viagem.
  vd AS (
    SELECT l.viagem_id, min(l.data)::date AS dt
      FROM public.erp_viagem_lancamento l
      JOIN obra o ON o.id = l.obra_id
     WHERE l.excluido_em IS NULL
     GROUP BY l.viagem_id
  ),
  via AS (
    SELECT date_trunc('month', vd.dt)::date AS mo,
           sum(COALESCE(vc.custo_total, 0)) AS v
      FROM public.v_viagem_custo_obra vc
      JOIN obra o ON o.id = vc.obra_id
      LEFT JOIN vd ON vd.viagem_id = vc.viagem_id
     GROUP BY 1
  ),
  -- GASTO: compras/subempreiteiros em contas a pagar pelo centro de custo da obra (mesmo filtro da view).
  cap AS (
    SELECT date_trunc('month', COALESCE(p.data_competencia, p.data_emissao))::date AS mo,
           sum(COALESCE(p.valor, 0)) AS v
      FROM public.erp_pagar p
      JOIN obra o ON o.company_id = p.company_id AND o.centro_custo_id = p.centro_custo_id
     WHERE p.deleted_at IS NULL
       AND p.status::text <> 'cancelado'
       AND p.centro_custo_id IS NOT NULL
       AND p.ref_externa_sistema IS DISTINCT FROM 'viagem'
     GROUP BY 1
  ),
  meses AS (
    SELECT mo FROM med
    UNION SELECT mo FROM ven
    UNION SELECT mo FROM cmv
    UNION SELECT mo FROM mo
    UNION SELECT mo FROM rt
    UNION SELECT mo FROM via
    UNION SELECT mo FROM cap
  ),
  linhas AS (
    SELECT x.mo,
           COALESCE(med.v, 0) AS receita_medicao,
           COALESCE(ven.v, 0) AS receita_venda,
           COALESCE(mo.v, 0)  AS custo_mao_obra,
           COALESCE(rt.v, 0)  AS custo_rateio,
           COALESCE(via.v, 0) AS custo_viagens,
           COALESCE(cap.v, 0) AS custo_contas_pagar,
           COALESCE(cmv.v, 0) AS custo_material
      FROM meses x
      LEFT JOIN med ON med.mo IS NOT DISTINCT FROM x.mo
      LEFT JOIN ven ON ven.mo IS NOT DISTINCT FROM x.mo
      LEFT JOIN cmv ON cmv.mo IS NOT DISTINCT FROM x.mo
      LEFT JOIN mo  ON mo.mo  IS NOT DISTINCT FROM x.mo
      LEFT JOIN rt  ON rt.mo  IS NOT DISTINCT FROM x.mo
      LEFT JOIN via ON via.mo IS NOT DISTINCT FROM x.mo
      LEFT JOIN cap ON cap.mo IS NOT DISTINCT FROM x.mo
  )
  SELECT
    CASE WHEN l.mo IS NULL THEN 'Sem data' ELSE to_char(l.mo, 'YYYY-MM') END AS mes,
    l.mo AS mes_ordem,
    l.receita_medicao,
    l.receita_venda,
    (l.receita_medicao + l.receita_venda) AS entrada,
    l.custo_mao_obra,
    l.custo_rateio,
    l.custo_viagens,
    l.custo_contas_pagar,
    l.custo_material,
    (l.custo_mao_obra + l.custo_rateio + l.custo_viagens + l.custo_contas_pagar + l.custo_material) AS saida,
    (l.receita_medicao + l.receita_venda
       - (l.custo_mao_obra + l.custo_rateio + l.custo_viagens + l.custo_contas_pagar + l.custo_material)) AS saldo_mes,
    sum(l.receita_medicao + l.receita_venda
       - (l.custo_mao_obra + l.custo_rateio + l.custo_viagens + l.custo_contas_pagar + l.custo_material))
      OVER (ORDER BY l.mo NULLS LAST ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS saldo_acumulado
  FROM linhas l
  ORDER BY l.mo NULLS LAST;
$function$;

COMMENT ON FUNCTION public.fn_obra_caixa_mensal(uuid) IS
  'Hub onda E: caixa da obra mês a mês (entrada = medições aprovadas + vendas; saída = as 5 fontes de custo de v_obra_resultado_alocado; saldo do mês e acumulado). Só leitura, escopo por empresa.';

REVOKE ALL ON FUNCTION public.fn_obra_caixa_mensal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_caixa_mensal(uuid) TO authenticated, service_role;

-- "?" (RD-95) das colunas da nova seção Caixa mês a mês.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('projetos.resultado_obra.caixa_mes',
  '/dashboard/projetos/obras/resultado', 'Caixa da obra', 'Mês',
  'Mês de competência do movimento (não precisa preencher nada: a tela monta sozinha a partir dos lançamentos da obra).',
  'Organiza o caixa da obra mês a mês, para você ver em que mês entrou e saiu dinheiro.',
  'Uma obra que faturou em setembro e teve custo de mão de obra em outubro aparece em duas linhas: 2026-09 e 2026-10.',
  'Lançamentos sem data caem na linha "Sem data"; corrija a data do lançamento para ele entrar no mês certo.',
  'hub_projetos', 310, 1, 'publicado'),
 ('projetos.resultado_obra.caixa_entrada',
  '/dashboard/projetos/obras/resultado', 'Caixa da obra', 'Entrada',
  'Soma do dinheiro que entrou no mês: medições aprovadas da obra mais as vendas vinculadas a ela.',
  'Mostra quanto a obra gerou de receita no mês, para comparar com o que foi gasto.',
  'Medição aprovada de R$ 50.000 + uma venda de material de R$ 8.000 no mesmo mês → Entrada R$ 58.000.',
  'Medição ainda em rascunho (não aprovada) não entra: aprove a medição para ela contar como entrada.',
  'hub_projetos', 311, 1, 'publicado'),
 ('projetos.resultado_obra.caixa_saida',
  '/dashboard/projetos/obras/resultado', 'Caixa da obra', 'Saída',
  'Soma do que a obra gastou no mês: materiais (CMV), viagens, mão de obra apontada, custo fixo rateado e compras/subempreiteiros em contas a pagar.',
  'Mostra o gasto do mês nas mesmas fontes do resultado da obra, para o caixa fechar com o custo total.',
  'Mão de obra R$ 12.000 + contas a pagar R$ 30.000 no mês → Saída R$ 42.000.',
  'Conta a pagar sem centro de custo da obra não entra aqui: amarre a conta ao centro de custo da obra.',
  'hub_projetos', 312, 1, 'publicado'),
 ('projetos.resultado_obra.caixa_saldo_mes',
  '/dashboard/projetos/obras/resultado', 'Caixa da obra', 'Saldo do mês',
  'Resultado de caixa do mês: entrada menos saída (verde quando sobra, vermelho quando falta).',
  'Diz se a obra, naquele mês, gerou ou consumiu caixa.',
  'Entrada R$ 58.000 e Saída R$ 42.000 → Saldo do mês R$ 16.000 (sobra).',
  'Confundir saldo do mês com lucro final da obra: aqui é só o caixa do mês, sem o previsto nem o orçamento total.',
  'hub_projetos', 313, 1, 'publicado'),
 ('projetos.resultado_obra.caixa_saldo_acumulado',
  '/dashboard/projetos/obras/resultado', 'Caixa da obra', 'Saldo acumulado',
  'Saldo do mês somado aos meses anteriores (o caixa que a obra acumulou até ali).',
  'Mostra se a obra, no acumulado, está com caixa positivo ou precisou de dinheiro de fora.',
  'Mês 1 +R$ 16.000 e Mês 2 −R$ 9.000 → Saldo acumulado R$ 7.000.',
  'Ler só o último mês e achar que a obra está no vermelho: olhe o acumulado para o quadro completo.',
  'hub_projetos', 314, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;

-- Blueprint vivo: a linha da caixa mês a mês passa a 'parcial' (realizado entregue; previsto vem da onda D).
UPDATE public.blueprint_tela_requisito
   SET status_baseline = 'parcial'
 WHERE vertical = 'hub_projetos'
   AND tela_num = 318
   AND requisito ILIKE 'Caixa da obra mês a mês%'
   AND status_baseline = 'ausente';
