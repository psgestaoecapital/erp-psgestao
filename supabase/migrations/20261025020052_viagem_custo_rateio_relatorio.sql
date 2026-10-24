-- Viagem · cálculo de custo (desenvolvedor_4_g, faixa 52) — caixa 50de72f9 (Eng. Chefe 24/10): rateio entre obras e
-- relatório de custo por viagem e por obra batendo 1:1 com o Resultado da obra (v_obra_resultado.custo_viagens).
-- ADITIVA: 1 coluna nova (rateio_origem_id, anulável), 2 funções novas e textos de ajuda novos. Nada existente é alterado.
--
-- Fonte única do custo de viagem na obra: o próprio lançamento (erp_viagem_lancamento.obra_id, sem excluídos) — é o que
-- v_obra_resultado soma em custo_viagens. Por isso o rateio NÃO grava em projetos_obra_rateio (contaria duas vezes em
-- v_obra_resultado_alocado): ele divide o lançamento em partes, uma por obra, e o Resultado da obra já enxerga.
--
-- 1) fn_viagem_lancamento_ratear(lançamento, partes) — divide um cupom entre obras por percentual:
--      • só viagem ABERTA e lançamento ainda fora do financeiro (pagar_id NULL);
--      • 2 a 10 partes, obras distintas e da empresa, percentuais > 0 somando 100,00;
--      • valor da parte = round(valor × % ÷ 100, 2); a diferença de centavos vai para a MAIOR parte (a soma fecha
--        exatamente no valor do cupom). Litros (abastecimento) idem com 3 casas;
--      • o original é excluído logicamente (RD-30) e cada parte nova guarda rateio_origem_id = original.
--    CONTA (gabarito do gate): 100,00 em 3 × 33,33% + 33,34% → 33,33 + 33,33 + 33,34 = 100,00.
-- 2) fn_viagem_custo_relatorio(empresa, de, até, obra) — só leitura, com a RLS de quem chama:
--      por viagem: total, despesas, abastecimentos, km (final − inicial), litros, km/l, custo/km (= total ÷ km, igual ao
--        fn_viagem_resumo), adiantamento, pago pelo colaborador, saldo e o rateio por obra (valor, %, km rateado);
--      por obra: viagens, total no período, km rateado (Σ km da viagem × valor da obra ÷ total da viagem),
--        custo/km da obra e a CONFERÊNCIA: total geral dos lançamentos da obra × custo_viagens do Resultado da obra
--        (mesma regra: lançamento não excluído), diferença e "bate".
--    Período filtra pela DATA do lançamento; sem período = tudo (aí total = total geral). Com obra escolhida, entram as
--    viagens que têm parte nela e totais.total é a parte da obra.
-- Plano de volta: DROP FUNCTION das 2 funções; a coluna fica (anulável, sem uso fora delas).

ALTER TABLE public.erp_viagem_lancamento ADD COLUMN IF NOT EXISTS rateio_origem_id uuid REFERENCES public.erp_viagem_lancamento(id);

-- ── 1) rateio de um lançamento entre obras ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_viagem_lancamento_ratear(p_lancamento_id uuid, p_partes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_l      public.erp_viagem_lancamento%ROWTYPE;
  v_status text;
  v_n      integer;
  v_soma   numeric;
  v_erros  text[] := ARRAY[]::text[];
  v_maior  integer;
  v_resto  numeric;
  v_resto_l numeric;
  v_ids    uuid[] := ARRAY[]::uuid[];
  v_id     uuid;
  r        record;
BEGIN
  SELECT * INTO v_l FROM public.erp_viagem_lancamento WHERE id = p_lancamento_id FOR UPDATE;
  IF NOT FOUND OR v_l.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Lançamento não encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(v_l.company_id);
  SELECT status INTO v_status FROM public.erp_viagem WHERE id = v_l.viagem_id;
  IF v_status <> 'aberta' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Viagem fechada não se altera'); END IF;
  IF v_l.pagar_id IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Lançamento já está no financeiro: ajuste o título antes'); END IF;
  IF p_partes IS NULL OR jsonb_typeof(p_partes) <> 'array' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe as partes do rateio'); END IF;

  CREATE TEMP TABLE IF NOT EXISTS _viagem_rateio (ord integer, obra_id uuid, pct numeric, valor numeric, litros numeric) ON COMMIT DROP;
  TRUNCATE _viagem_rateio;
  INSERT INTO _viagem_rateio (ord, obra_id, pct)
  SELECT e.ord::integer, NULLIF(e.p->>'obra_id', '')::uuid, NULLIF(e.p->>'percentual', '')::numeric
    FROM jsonb_array_elements(p_partes) WITH ORDINALITY AS e(p, ord);

  SELECT count(*), COALESCE(sum(pct), 0) INTO v_n, v_soma FROM _viagem_rateio;
  IF v_n < 2 OR v_n > 10 THEN v_erros := array_append(v_erros, 'partes: de 2 a 10 obras'::text); END IF;
  IF EXISTS (SELECT 1 FROM _viagem_rateio WHERE obra_id IS NULL OR pct IS NULL OR pct <= 0) THEN
    v_erros := array_append(v_erros, 'parte: cada uma precisa de obra e percentual maior que zero'::text);
  END IF;
  IF round(v_soma, 2) <> 100 THEN v_erros := array_append(v_erros, format('percentuais: somam %s%%, precisam somar 100%%', round(v_soma, 2))); END IF;
  IF (SELECT count(DISTINCT obra_id) FROM _viagem_rateio) <> v_n THEN v_erros := array_append(v_erros, 'obras: repetidas no rateio'::text); END IF;
  IF EXISTS (SELECT 1 FROM _viagem_rateio t WHERE t.obra_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.projetos_obras o WHERE o.id = t.obra_id AND o.company_id = v_l.company_id)) THEN
    v_erros := array_append(v_erros, 'obra: não é desta empresa'::text);
  END IF;
  IF array_length(v_erros, 1) > 0 THEN RETURN jsonb_build_object('ok', false, 'erros', to_jsonb(v_erros)); END IF;

  -- valores por parte; centavos (e milésimos de litro) que sobram vão para a maior parte
  UPDATE _viagem_rateio SET valor = round(v_l.valor * pct / 100, 2),
                            litros = CASE WHEN v_l.litros IS NOT NULL THEN round(v_l.litros * pct / 100, 3) END;
  SELECT ord INTO v_maior FROM _viagem_rateio ORDER BY pct DESC, ord DESC LIMIT 1;
  SELECT v_l.valor - sum(valor), CASE WHEN v_l.litros IS NOT NULL THEN v_l.litros - sum(litros) END
    INTO v_resto, v_resto_l FROM _viagem_rateio;
  UPDATE _viagem_rateio SET valor = valor + v_resto, litros = litros + COALESCE(v_resto_l, 0) WHERE ord = v_maior;
  IF EXISTS (SELECT 1 FROM _viagem_rateio WHERE valor <= 0 OR (v_l.tipo = 'abastecimento' AND COALESCE(litros, 0) <= 0)) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Parte pequena demais: o valor (ou os litros) de alguma obra ficou zerado');
  END IF;

  UPDATE public.erp_viagem_lancamento SET excluido_em = now(), excluido_por = auth.uid() WHERE id = v_l.id;
  FOR r IN SELECT * FROM _viagem_rateio ORDER BY ord LOOP
    INSERT INTO public.erp_viagem_lancamento (company_id, viagem_id, tipo, data, fornecedor_nome, documento, tipo_despesa, categoria,
       descricao, forma_pagamento, pago_colaborador, valor, obra_id, placa, hodometro, litros, tanque_cheio, anexo_path,
       origem_registro, criado_por, rateio_origem_id)
    VALUES (v_l.company_id, v_l.viagem_id, v_l.tipo, v_l.data, v_l.fornecedor_nome, v_l.documento, v_l.tipo_despesa, v_l.categoria,
       v_l.descricao, v_l.forma_pagamento, v_l.pago_colaborador, r.valor, r.obra_id, v_l.placa, v_l.hodometro, r.litros,
       v_l.tanque_cheio, v_l.anexo_path, v_l.origem_registro, auth.uid(), v_l.id)
    RETURNING id INTO v_id;
    v_ids := array_append(v_ids, v_id);
  END LOOP;
  UPDATE public.erp_viagem SET atualizado_em = now() WHERE id = v_l.viagem_id;
  RETURN jsonb_build_object('ok', true, 'origem_id', v_l.id, 'ids', to_jsonb(v_ids),
    'partes', (SELECT jsonb_agg(jsonb_build_object('obra_id', obra_id, 'percentual', pct, 'valor', valor, 'litros', litros) ORDER BY ord) FROM _viagem_rateio));
END $function$;
REVOKE ALL ON FUNCTION public.fn_viagem_lancamento_ratear(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_viagem_lancamento_ratear(uuid, jsonb) TO authenticated, service_role;

-- ── 2) relatório de custo por viagem e por obra (com a conferência contra o Resultado da obra) ─────────────────
CREATE OR REPLACE FUNCTION public.fn_viagem_custo_relatorio(p_company_id uuid, p_de date DEFAULT NULL, p_ate date DEFAULT NULL, p_obra_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  WITH acesso AS (SELECT (public.is_admin() OR p_company_id IN (SELECT public.get_user_company_ids())) AS ok),
  l AS (
    SELECT x.* FROM public.erp_viagem_lancamento x, acesso
     WHERE acesso.ok AND x.company_id = p_company_id AND x.excluido_em IS NULL
       AND (p_de IS NULL OR x.data >= p_de) AND (p_ate IS NULL OR x.data <= p_ate)),
  v AS (
    SELECT g.*, CASE WHEN g.km_inicial IS NOT NULL AND g.km_final IS NOT NULL AND g.km_final >= g.km_inicial
                     THEN g.km_final - g.km_inicial END AS km
      FROM public.erp_viagem g
     WHERE g.excluido_em IS NULL AND g.id IN (SELECT viagem_id FROM l)),
  tv AS (
    SELECT viagem_id,
           round(sum(valor), 2) AS total,
           round(COALESCE(sum(valor) FILTER (WHERE tipo = 'despesa'), 0), 2) AS despesas,
           round(COALESCE(sum(valor) FILTER (WHERE tipo = 'abastecimento'), 0), 2) AS abastecimentos,
           round(COALESCE(sum(valor) FILTER (WHERE pago_colaborador), 0), 2) AS pago_colaborador,
           round(COALESCE(sum(litros) FILTER (WHERE tipo = 'abastecimento'), 0), 3) AS litros
      FROM l GROUP BY viagem_id),
  vo AS (  -- rateio: quanto de cada viagem caiu em cada obra
    SELECT l.viagem_id, l.obra_id, round(sum(l.valor), 2) AS valor FROM l GROUP BY l.viagem_id, l.obra_id),
  vo_km AS (
    SELECT vo.*, round(vo.valor * 100 / NULLIF(tv.total, 0), 2) AS pct,
           CASE WHEN v.km IS NOT NULL AND tv.total > 0 THEN round(v.km * vo.valor / tv.total, 1) END AS km_rateado
      FROM vo JOIN tv ON tv.viagem_id = vo.viagem_id JOIN v ON v.id = vo.viagem_id),
  geral AS (  -- mesma regra do v_obra_resultado.custo_viagens: todos os lançamentos não excluídos, sem período
    SELECT x.obra_id, round(sum(x.valor), 2) AS total FROM public.erp_viagem_lancamento x, acesso
     WHERE acesso.ok AND x.company_id = p_company_id AND x.excluido_em IS NULL GROUP BY x.obra_id),
  ob AS (
    SELECT o.id AS obra_id, o.numero, o.nome,
           count(DISTINCT k.viagem_id) AS viagens,
           COALESCE(round(sum(k.valor), 2), 0) AS total,
           round(sum(k.km_rateado), 1) AS km_rateado,
           COALESCE(gr.total, 0) AS total_geral,
           COALESCE(r.custo_viagens, 0)::numeric(15,2) AS custo_viagens_resultado
      FROM public.projetos_obras o
      LEFT JOIN vo_km k ON k.obra_id = o.id
      LEFT JOIN geral gr ON gr.obra_id = o.id
      LEFT JOIN public.v_obra_resultado r ON r.obra_id = o.id
     WHERE o.company_id = p_company_id AND (k.obra_id IS NOT NULL OR gr.obra_id IS NOT NULL)
       AND (p_obra_id IS NULL OR o.id = p_obra_id)
     GROUP BY o.id, o.numero, o.nome, gr.total, r.custo_viagens),
  vj AS (
    SELECT v.*, tv.total, tv.despesas, tv.abastecimentos, tv.pago_colaborador, tv.litros
      FROM v JOIN tv ON tv.viagem_id = v.id
     WHERE p_obra_id IS NULL OR EXISTS (SELECT 1 FROM vo WHERE vo.viagem_id = v.id AND vo.obra_id = p_obra_id))
  SELECT CASE WHEN NOT (SELECT ok FROM acesso) THEN jsonb_build_object('ok', false, 'erro', 'Empresa sem acesso') ELSE jsonb_build_object(
    'ok', true,
    'periodo', jsonb_build_object('de', p_de, 'ate', p_ate),
    'viagens', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'viagem_id', vj.id, 'numero', vj.numero, 'colaborador', vj.colaborador_nome, 'status', vj.status,
        'periodo_inicio', vj.periodo_inicio, 'periodo_fim', vj.periodo_fim, 'obra_principal_id', vj.obra_id,
        'origem', vj.origem, 'destino', vj.destino, 'placa', vj.placa,
        'total', vj.total, 'despesas', vj.despesas, 'abastecimentos', vj.abastecimentos,
        'km_rodado', vj.km, 'litros', vj.litros,
        'media_km_l', CASE WHEN vj.km IS NOT NULL AND vj.litros > 0 THEN round(vj.km / vj.litros, 2) END,
        'custo_km', CASE WHEN vj.km > 0 THEN round(vj.total / vj.km, 2) END,
        'adiantamento', vj.adiantamento, 'pago_colaborador', vj.pago_colaborador,
        'saldo', round(vj.adiantamento - vj.pago_colaborador, 2),
        'rateio', (SELECT jsonb_agg(jsonb_build_object('obra_id', k.obra_id, 'valor', k.valor, 'percentual', k.pct, 'km_rateado', k.km_rateado)
                                    ORDER BY k.valor DESC) FROM vo_km k WHERE k.viagem_id = vj.id)
      ) ORDER BY vj.periodo_inicio DESC, vj.numero DESC) FROM vj), '[]'::jsonb),
    'obras', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'obra_id', ob.obra_id, 'numero', ob.numero, 'nome', ob.nome, 'viagens', ob.viagens, 'total', ob.total,
        'km_rateado', ob.km_rateado, 'custo_km', CASE WHEN ob.km_rateado > 0 THEN round(ob.total / ob.km_rateado, 2) END,
        'total_geral', ob.total_geral, 'custo_viagens_resultado', ob.custo_viagens_resultado,
        'diferenca', round(ob.total_geral - ob.custo_viagens_resultado, 2),
        'bate', ob.total_geral = ob.custo_viagens_resultado
      ) ORDER BY ob.total DESC, ob.numero) FROM ob), '[]'::jsonb),
    'totais', jsonb_build_object(
        'viagens', (SELECT count(*) FROM vj),
        -- com obra escolhida, o total é a PARTE da obra (rateio), não a viagem inteira
        'total', CASE WHEN p_obra_id IS NULL THEN COALESCE((SELECT round(sum(total), 2) FROM vj), 0)
                      ELSE COALESCE((SELECT round(sum(valor), 2) FROM vo WHERE vo.obra_id = p_obra_id), 0) END,
        'km', (SELECT round(sum(km), 1) FROM vj),
        'custo_km', (SELECT CASE WHEN sum(km) FILTER (WHERE km > 0) > 0
                                 THEN round(sum(total) FILTER (WHERE km > 0) / sum(km) FILTER (WHERE km > 0), 2) END FROM vj),
        'bate_resultado', COALESCE((SELECT bool_and(bate) FROM (SELECT ob.total_geral = ob.custo_viagens_resultado AS bate FROM ob) b), true))
  ) END
$function$;
REVOKE ALL ON FUNCTION public.fn_viagem_custo_relatorio(uuid, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_viagem_custo_relatorio(uuid, date, date, uuid) TO authenticated, service_role;

-- ── 3) "?" (RD-95) dos campos do rateio e do relatório ──────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/viagens', 'hub_construcao', 'publicado'
FROM (VALUES
  ('projetos.viagem.ratear_obra', 'Ratear cupom', 'Obra da parte', 'Cada obra que divide este cupom.', 'O valor da parte cai no custo de viagens do Resultado daquela obra.', 'Obra 0153 · Galpão', 'Repetir a mesma obra em duas partes: o sistema recusa.', 30),
  ('projetos.viagem.ratear_percentual', 'Ratear cupom', 'Percentual da parte', 'Quanto deste cupom é desta obra, em %. As partes somam 100%.', 'Divide o valor (e os litros) do cupom; centavos que sobram vão para a maior parte.', '60% e 40%', 'Partes que não somam 100%: o sistema recusa.', 31),
  ('projetos.viagem.rel_periodo', 'Relatório de custo', 'Período', 'De e até: as datas dos cupons que entram no relatório. Em branco = tudo.', 'Recorta o custo das viagens no mês ou na quinzena.', '01/10/2026 a 31/10/2026', 'Esperar que o período bata com o Resultado da obra: a conferência usa o total geral.', 32),
  ('projetos.viagem.rel_custo_km', 'Relatório de custo', 'Custo por km', 'Calculado: total da viagem ÷ km rodado.', 'Compara viagens e obras pelo custo de cada km.', 'R$ 984,05 ÷ 288 km = R$ 3,42/km', 'Viagem sem km final fica sem custo por km.', 33),
  ('projetos.viagem.rel_km_rateado', 'Relatório de custo', 'Km rateado', 'Calculado: km da viagem × parte do valor que foi para a obra.', 'Dá o custo por km de cada obra quando uma viagem atende várias.', '288 km × 60% = 172,8 km', 'Ler como km rodado dentro da obra: é a parte do trajeto que coube a ela.', 34),
  ('projetos.viagem.rel_conferencia', 'Relatório de custo', 'Confere com o Resultado da obra', 'Calculado: total geral de viagens da obra × custo de viagens no Resultado da obra.', 'Prova que o relatório e o Resultado da obra contam o mesmo valor.', 'Bate · diferença R$ 0,00', 'Diferença diferente de zero: avise o suporte, um dos dois está errado.', 35)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
