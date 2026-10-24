-- Viagem · relatório de custo (por viagem e por obra) conferido 1:1 com o Resultado da obra — desenvolvedor_4_g (faixa 52).
-- ADITIVA: função NOVA, só leitura (SECURITY INVOKER: respeita a RLS de erp_viagem/erp_viagem_lancamento/v_obra_resultado),
-- e textos novos de ajuda ("?", RD-95). Nada existente é alterado.
--
-- Contrato de dados para a tela /dashboard/projetos/viagens (gilberto-esteira) — tipos em src/lib/viagem/relatorioCusto.ts:
--   fn_viagem_relatorio_custo(p_company_id, p_obra_id NULL, p_inicio NULL, p_fim NULL) → jsonb
--   { ok, filtros, totais, viagens[], obras[], conferencia }
-- Regras do cálculo (as MESMAS de fn_viagem_resumo e de v_obra_resultado, para o número bater):
--   custo da viagem   = Σ lançamentos não excluídos (despesas + abastecimentos);
--   custo na obra     = Σ lançamentos daquela obra (cada cupom tem a SUA obra — é o rateio entre obras);
--   km rodado         = km final − km inicial (só com os dois e final ≥ inicial);
--   custo por km      = custo ÷ km rodado;  média = km ÷ litros;
--   km rateado na obra = km da viagem × (custo na obra ÷ custo da viagem) — o km segue o dinheiro;
--   custo/km da obra  = Σ custo na obra ÷ Σ km rateado (só das viagens com km);
--   viagem na lixeira (excluido_em) ou cancelada NÃO entra.
-- Filtros: p_obra_id = só os lançamentos dessa obra (a viagem aparece se tiver cupom nela); p_inicio/p_fim = viagens cuja
-- SAÍDA cai no intervalo. A conferência com o Resultado é SEMPRE sem filtro de data (o Resultado é acumulado da obra):
-- por obra, relatório × v_obra_resultado.custo_viagens, com a diferença; 'bate' = todas as diferenças zeradas.

CREATE OR REPLACE FUNCTION public.fn_viagem_relatorio_custo(
  p_company_id uuid,
  p_obra_id    uuid DEFAULT NULL,
  p_inicio     date DEFAULT NULL,
  p_fim        date DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF p_inicio IS NOT NULL AND p_fim IS NOT NULL AND p_fim < p_inicio THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'O fim do período não pode ser antes do início');
  END IF;

  WITH
  -- viagens válidas da empresa (fora da lixeira, não canceladas) no período
  v AS (
    SELECT x.* FROM public.erp_viagem x
     WHERE x.company_id = p_company_id AND x.excluido_em IS NULL AND x.status <> 'cancelada'
       AND (p_inicio IS NULL OR x.periodo_inicio >= p_inicio)
       AND (p_fim IS NULL OR x.periodo_inicio <= p_fim)
  ),
  -- todos os lançamentos dessas viagens (a viagem inteira, para o total e o custo/km da viagem)
  l_all AS (
    SELECT l.* FROM public.erp_viagem_lancamento l JOIN v ON v.id = l.viagem_id WHERE l.excluido_em IS NULL
  ),
  vt AS (
    SELECT v.id,
           round(COALESCE(sum(l.valor), 0), 2)                                         AS total,
           round(COALESCE(sum(l.valor) FILTER (WHERE l.tipo = 'despesa'), 0), 2)       AS total_despesas,
           round(COALESCE(sum(l.valor) FILTER (WHERE l.tipo = 'abastecimento'), 0), 2) AS total_abastecimentos,
           round(COALESCE(sum(l.valor) FILTER (WHERE l.pago_colaborador), 0), 2)       AS pago_colaborador,
           round(COALESCE(sum(l.litros) FILTER (WHERE l.tipo = 'abastecimento'), 0), 3) AS litros,
           count(l.id)                                                                  AS lancamentos,
           CASE WHEN v.km_inicial IS NOT NULL AND v.km_final IS NOT NULL AND v.km_final >= v.km_inicial
                THEN v.km_final - v.km_inicial END                                     AS km
      FROM v LEFT JOIN l_all l ON l.viagem_id = v.id
     GROUP BY v.id, v.km_inicial, v.km_final
  ),
  -- custo de cada viagem em cada obra (o rateio), com o km que acompanha o dinheiro
  vo AS (
    SELECT l.viagem_id, l.obra_id, round(sum(l.valor), 2) AS valor,
           count(*) AS lancamentos,
           CASE WHEN vt.km IS NOT NULL AND vt.total > 0 THEN round(vt.km * sum(l.valor) / vt.total, 1) END AS km_rateado
      FROM l_all l JOIN vt ON vt.id = l.viagem_id
     GROUP BY l.viagem_id, l.obra_id, vt.km, vt.total
  ),
  -- filtro por obra: só as viagens com cupom na obra pedida
  vsel AS (
    SELECT v.* FROM v
     WHERE p_obra_id IS NULL OR EXISTS (SELECT 1 FROM vo WHERE vo.viagem_id = v.id AND vo.obra_id = p_obra_id)
  ),
  vo_sel AS (SELECT vo.* FROM vo WHERE p_obra_id IS NULL OR vo.obra_id = p_obra_id),
  ob AS (
    SELECT vo.obra_id,
           round(sum(vo.valor), 2)                                     AS custo,
           round(sum(vo.valor) FILTER (WHERE vo.km_rateado IS NOT NULL), 2) AS custo_com_km,
           round(sum(vo.km_rateado), 1)                                AS km_rateado,
           count(DISTINCT vo.viagem_id)                                AS viagens,
           sum(vo.lancamentos)                                         AS lancamentos
      FROM vo_sel vo JOIN vsel ON vsel.id = vo.viagem_id
     GROUP BY vo.obra_id
  ),
  ob_cat AS (
    SELECT l.obra_id, l.categoria, max(pc.descricao) AS descricao, round(sum(l.valor), 2) AS valor
      FROM l_all l JOIN vsel ON vsel.id = l.viagem_id
      LEFT JOIN public.erp_plano_contas pc ON pc.company_id = p_company_id AND pc.codigo = l.categoria
     WHERE p_obra_id IS NULL OR l.obra_id = p_obra_id
     GROUP BY l.obra_id, l.categoria
  ),
  -- conferência com o Resultado da obra: acumulado, sem filtro de data (mesma base: lançamentos da obra)
  rel_acum AS (
    SELECT l.obra_id, round(sum(l.valor), 2) AS valor
      FROM public.erp_viagem_lancamento l
      JOIN public.erp_viagem x ON x.id = l.viagem_id AND x.excluido_em IS NULL AND x.status <> 'cancelada'
     WHERE l.company_id = p_company_id AND l.excluido_em IS NULL
       AND (p_obra_id IS NULL OR l.obra_id = p_obra_id)
     GROUP BY l.obra_id
  ),
  conf AS (
    SELECT COALESCE(r.obra_id, a.obra_id) AS obra_id,
           COALESCE(a.valor, 0)::numeric(15,2)          AS relatorio,
           COALESCE(r.custo_viagens, 0)::numeric(15,2)  AS resultado
      FROM (SELECT obra_id, custo_viagens FROM public.v_obra_resultado
             WHERE company_id = p_company_id AND custo_viagens <> 0
               AND (p_obra_id IS NULL OR obra_id = p_obra_id)) r
      FULL JOIN rel_acum a ON a.obra_id = r.obra_id
  )
  SELECT jsonb_build_object(
    'ok', true,
    'filtros', jsonb_build_object('company_id', p_company_id, 'obra_id', p_obra_id, 'inicio', p_inicio, 'fim', p_fim),
    'totais', (
      SELECT jsonb_build_object(
        'viagens', count(*),
        'custo', round(COALESCE(sum(CASE WHEN p_obra_id IS NULL THEN vt.total
                                         ELSE (SELECT vo.valor FROM vo_sel vo WHERE vo.viagem_id = vt.id) END), 0), 2),
        'km_rodado', round(sum(CASE WHEN p_obra_id IS NULL THEN vt.km
                                    ELSE (SELECT vo.km_rateado FROM vo_sel vo WHERE vo.viagem_id = vt.id) END), 1),
        'custo_km', (SELECT CASE WHEN sum(o.km_rateado) > 0 THEN round(sum(o.custo_com_km) / sum(o.km_rateado), 2) END FROM ob o),
        'obras', (SELECT count(*) FROM ob))
        FROM vt JOIN vsel ON vsel.id = vt.id),
    'viagens', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'viagem_id', x.id, 'numero', x.numero, 'colaborador', x.colaborador_nome, 'placa', x.placa,
               'status', x.status, 'periodo_inicio', x.periodo_inicio, 'periodo_fim', x.periodo_fim,
               'origem', x.origem, 'destino', x.destino, 'obra_principal_id', x.obra_id,
               'custo', vt.total, 'total_despesas', vt.total_despesas, 'total_abastecimentos', vt.total_abastecimentos,
               'km_rodado', vt.km, 'litros', vt.litros,
               'media_km_l', CASE WHEN vt.km IS NOT NULL AND vt.litros > 0 THEN round(vt.km / vt.litros, 2) END,
               'custo_km', CASE WHEN vt.km > 0 THEN round(vt.total / vt.km, 2) END,
               'adiantamento', x.adiantamento, 'pago_colaborador', vt.pago_colaborador,
               'saldo', round(x.adiantamento - vt.pago_colaborador, 2),
               'saldo_texto', CASE WHEN x.adiantamento - vt.pago_colaborador > 0 THEN 'colaborador devolve à empresa'
                                   WHEN x.adiantamento - vt.pago_colaborador < 0 THEN 'empresa reembolsa o colaborador'
                                   ELSE 'acertado' END,
               'lancamentos', vt.lancamentos,
               'por_obra', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                 'obra_id', vo.obra_id, 'obra_numero', o.numero, 'obra_nome', o.nome,
                                 'custo', vo.valor, 'km_rateado', vo.km_rateado,
                                 'participacao_pct', CASE WHEN vt.total > 0 THEN round(100 * vo.valor / vt.total, 2) END)
                               ORDER BY vo.valor DESC)
                             FROM vo LEFT JOIN public.projetos_obras o ON o.id = vo.obra_id
                            WHERE vo.viagem_id = x.id), '[]'::jsonb))
             ORDER BY x.periodo_inicio DESC, x.numero DESC)
        FROM vsel x JOIN vt ON vt.id = x.id), '[]'::jsonb),
    'obras', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'obra_id', ob.obra_id, 'obra_numero', o.numero, 'obra_nome', o.nome,
               'custo', ob.custo, 'km_rateado', ob.km_rateado,
               'custo_km', CASE WHEN ob.km_rateado > 0 THEN round(ob.custo_com_km / ob.km_rateado, 2) END,
               'viagens', ob.viagens, 'lancamentos', ob.lancamentos,
               'por_categoria', COALESCE((SELECT jsonb_agg(jsonb_build_object('categoria', c.categoria, 'descricao', c.descricao, 'custo', c.valor)
                                                 ORDER BY c.valor DESC)
                                            FROM ob_cat c WHERE c.obra_id = ob.obra_id), '[]'::jsonb))
             ORDER BY ob.custo DESC)
        FROM ob LEFT JOIN public.projetos_obras o ON o.id = ob.obra_id), '[]'::jsonb),
    'conferencia', jsonb_build_object(
      'escopo', 'acumulado da obra (sem filtro de data), igual ao Resultado da obra',
      'bate', NOT EXISTS (SELECT 1 FROM conf WHERE conf.relatorio <> conf.resultado),
      'obras', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                           'obra_id', conf.obra_id, 'obra_numero', o.numero, 'obra_nome', o.nome,
                           'relatorio', conf.relatorio, 'resultado', conf.resultado,
                           'diferenca', (conf.relatorio - conf.resultado)::numeric(15,2))
                         ORDER BY o.numero)
                         FROM conf LEFT JOIN public.projetos_obras o ON o.id = conf.obra_id), '[]'::jsonb))
  ) INTO v_out;

  RETURN v_out;
END $function$;

REVOKE ALL ON FUNCTION public.fn_viagem_relatorio_custo(uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_viagem_relatorio_custo(uuid, uuid, date, date) TO authenticated, service_role;

-- "?" (RD-95) dos campos do relatório de custo — a tela usa estas chaves.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT r.chave, r.grupo, r.rotulo, r.o_que, r.para_que, r.exemplo, r.erro, r.ordem, '/dashboard/projetos/viagens', 'hub_construcao', 'publicado'
FROM (VALUES
  ('projetos.viagem.rel_filtro_obra', 'Relatório de custo', 'Obra', 'Escolha uma obra para ver só os gastos de viagem dela, ou deixe "Todas".', 'Mostra quanto as viagens custaram para aquela obra, cupom a cupom.', 'Obra 0153 · Galpão', 'Esperar ver a viagem inteira: com obra escolhida, aparece só a parte da viagem que caiu nela.', 30),
  ('projetos.viagem.rel_filtro_periodo', 'Relatório de custo', 'Período', 'O intervalo de datas de SAÍDA das viagens que entram no relatório.', 'Separa o custo de deslocamento por mês ou por etapa da obra.', '01/10/2026 a 31/10/2026', 'Comparar com o Resultado da obra usando período: o Resultado é o acumulado da obra inteira.', 31),
  ('projetos.viagem.rel_custo_viagem', 'Relatório de custo', 'Custo da viagem', 'Calculado: soma de todos os cupons (despesas e abastecimentos) da viagem.', 'É o quanto a viagem custou à empresa, independente de quem pagou.', 'R$ 984,05', 'Confundir com o saldo do acerto: o saldo é o que falta devolver ou reembolsar.', 32),
  ('projetos.viagem.rel_km_rodado', 'Relatório de custo', 'Km rodado', 'Calculado: km final menos km inicial da viagem.', 'Base do custo por km e do consumo.', '288 km', 'Sem km inicial e final na viagem, o km fica em branco e o custo por km não sai.', 33),
  ('projetos.viagem.rel_custo_km', 'Relatório de custo', 'Custo por km', 'Calculado: custo dividido pelo km rodado.', 'Compara viagens e obras: quanto cada km de deslocamento custou.', 'R$ 3,42/km', 'Comparar viagem com hotel e viagem só de ida: o custo por km inclui todos os gastos, não só combustível.', 34),
  ('projetos.viagem.rel_km_rateado', 'Relatório de custo', 'Km rateado', 'Calculado: o km da viagem dividido entre as obras na mesma proporção do custo de cada uma.', 'Mostra quantos km de deslocamento cada obra "consumiu" quando a viagem atendeu mais de uma obra.', '190 km de 288', 'Achar que é o km real até a obra: é a parte proporcional ao custo lançado nela.', 35),
  ('projetos.viagem.rel_custo_obra', 'Relatório de custo', 'Custo na obra', 'Calculado: soma dos cupons lançados nesta obra (cada cupom tem a sua obra).', 'É o valor que entra como custo de viagens no Resultado da obra.', 'R$ 984,05', 'Lançar o cupom na obra principal quando o gasto foi de outra obra.', 36),
  ('projetos.viagem.rel_participacao', 'Relatório de custo', 'Participação', 'Calculado: quanto do custo da viagem ficou com cada obra, em %.', 'Mostra o rateio da viagem entre as obras atendidas.', '65% Obra 0153 · 35% Obra 0160', 'Somar mais de 100%: confira se algum cupom foi lançado duas vezes.', 37),
  ('projetos.viagem.rel_conferencia', 'Relatório de custo', 'Confere com o Resultado', 'Calculado: compara, obra a obra, o custo de viagens deste relatório com o do Resultado da obra.', 'Garante que o número que você vê aqui é o mesmo do Resultado (sem conta paralela).', 'Confere · diferença R$ 0,00', 'Ignorar uma diferença: ela indica viagem cancelada ou na lixeira com cupom ainda contando no Resultado.', 38)
) r(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
