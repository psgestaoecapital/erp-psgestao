-- Viagem · custo por obra, rateio e relatório (Eng. Chefe 24/10 · prioridade terça · desenvolvedor_4_g, faixa 52).
-- O CÁLCULO da viagem fica num lugar só, no banco, em cima dos lançamentos do GE integrado (RD-35). A tela
-- (/dashboard/projetos/viagens, lane gilberto-esteira) só lê o que sai daqui.
--
--   1) erp_viagem_obra: as obras que a viagem atendeu e o PESO de cada uma (km, dias ou %). Sem linhas = a viagem
--      inteira é da obra principal (como hoje).
--   2) erp_viagem_lancamento.rateio: o cupom é custo COMPARTILHADO da viagem (combustível, pedágio, hotel da equipe)
--      e se divide entre as obras da viagem pelo peso. Sem a marca, o cupom fica inteiro na obra dele (como hoje).
--   3) v_viagem_custo_obra: a FONTE ÚNICA do custo de viagem por (viagem, obra). Divide em centavos e joga a sobra do
--      arredondamento na obra de maior peso, então a soma por obra = soma dos cupons, centavo a centavo.
--      Viagem cancelada ou excluída não entra.
--   4) v_obra_resultado.custo_viagens passa a ler a v_viagem_custo_obra (mesmas colunas; muda só a origem do custo de
--      viagem) → o Resultado da obra e o relatório saem da MESMA conta (1:1).
--   5) fn_viagem_relatorio: por viagem (total, km, custo/km, consumo, saldo do acerto, rateio) e por obra (custo de
--      viagem no período e no Resultado), com a conferência 1:1 contra a v_obra_resultado.
-- Gravação só pelas funções com guarda de empresa; exclusão lógica (RD-30); nada aberto a anon.

-- ── 1) obras da viagem e peso do rateio ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_viagem_obra (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  viagem_id    uuid NOT NULL REFERENCES public.erp_viagem(id) ON DELETE CASCADE,
  obra_id      uuid NOT NULL REFERENCES public.projetos_obras(id),
  criterio     text NOT NULL CHECK (criterio IN ('km', 'dias', 'percentual')),
  peso         numeric(12,3) NOT NULL CHECK (peso > 0),
  criado_por   uuid,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  excluido_em  timestamptz,
  excluido_por uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS erp_viagem_obra_unica_idx ON public.erp_viagem_obra (viagem_id, obra_id) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS erp_viagem_obra_obra_idx ON public.erp_viagem_obra (obra_id) WHERE excluido_em IS NULL;

ALTER TABLE public.erp_viagem_obra ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_viagem_obra FROM PUBLIC, anon;
DROP POLICY IF EXISTS erp_viagem_obra_ler ON public.erp_viagem_obra;
CREATE POLICY erp_viagem_obra_ler ON public.erp_viagem_obra FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
GRANT SELECT ON public.erp_viagem_obra TO authenticated;

-- ── 2) cupom compartilhado (coluna nova; padrão = como hoje, inteiro na obra do cupom) ────────────────────────
ALTER TABLE public.erp_viagem_lancamento ADD COLUMN IF NOT EXISTS rateio boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS erp_viagem_lancamento_obra_idx ON public.erp_viagem_lancamento (obra_id) WHERE excluido_em IS NULL;

-- ── 3) fonte única: custo de viagem por (viagem, obra) ───────────────────────────────────────────────────────
--   cupom sem rateio (ou viagem sem obras de rateio) → inteiro na obra do cupom;
--   cupom com rateio → cota = round(valor × peso ÷ Σ pesos, 2); a sobra dos centavos vai para a obra de maior peso
--   (empate: menor obra_id), então Σ cotas = valor do cupom.
CREATE OR REPLACE VIEW public.v_viagem_custo_obra
WITH (security_invoker = true) AS
WITH v AS (
  SELECT id, company_id FROM public.erp_viagem WHERE excluido_em IS NULL AND status <> 'cancelada'
),
l AS (
  SELECT x.id, x.viagem_id, x.company_id, x.obra_id, x.valor, x.rateio
    FROM public.erp_viagem_lancamento x JOIN v ON v.id = x.viagem_id
   WHERE x.excluido_em IS NULL
),
p AS (
  SELECT o.viagem_id, o.obra_id, o.peso,
         sum(o.peso) OVER (PARTITION BY o.viagem_id) AS peso_total,
         row_number() OVER (PARTITION BY o.viagem_id ORDER BY o.peso DESC, o.obra_id) AS ordem
    FROM public.erp_viagem_obra o JOIN v ON v.id = o.viagem_id
   WHERE o.excluido_em IS NULL
),
direto AS (
  SELECT l.company_id, l.viagem_id, l.obra_id, l.valor AS direto, 0::numeric AS rateado
    FROM l
   WHERE NOT l.rateio OR NOT EXISTS (SELECT 1 FROM p WHERE p.viagem_id = l.viagem_id)
),
cota AS (
  SELECT l.id, l.company_id, l.viagem_id, p.obra_id, p.ordem, l.valor,
         round(l.valor * p.peso / p.peso_total, 2) AS cota
    FROM l JOIN p ON p.viagem_id = l.viagem_id
   WHERE l.rateio
),
rateado AS (
  SELECT c.company_id, c.viagem_id, c.obra_id, 0::numeric AS direto,
         c.cota + CASE WHEN c.ordem = 1 THEN c.valor - sum(c.cota) OVER (PARTITION BY c.id) ELSE 0 END AS rateado
    FROM cota c
)
SELECT company_id, viagem_id, obra_id,
       round(sum(direto), 2)::numeric(15,2)           AS custo_direto,
       round(sum(rateado), 2)::numeric(15,2)          AS custo_rateado,
       round(sum(direto + rateado), 2)::numeric(15,2) AS custo_total
  FROM (SELECT * FROM direto UNION ALL SELECT * FROM rateado) t
 GROUP BY company_id, viagem_id, obra_id;

REVOKE ALL ON public.v_viagem_custo_obra FROM PUBLIC, anon;
GRANT SELECT ON public.v_viagem_custo_obra TO authenticated;

-- ── 4) Resultado da obra: custo_viagens sai da fonte única (mesmas colunas, mesma ordem) ─────────────────────
CREATE OR REPLACE VIEW public.v_obra_resultado
WITH (security_invoker = true) AS
SELECT
  o.id AS obra_id,
  o.company_id,
  o.numero,
  o.nome,
  o.status,
  COALESCE(prev.custo_previsto, 0)::numeric(15,2)  AS custo_previsto,
  COALESCE(prev.valor_contratado, 0)::numeric(15,2) AS receita_prevista,
  COALESCE(med.valor, 0)::numeric(15,2)            AS receita_servico,
  COALESCE(ped.receita, 0)::numeric(15,2)          AS receita_material,
  COALESCE(ped.cmv, 0)::numeric(15,2)              AS custo_material,
  COALESCE(via.valor, 0)::numeric(15,2)            AS custo_viagens,
  (COALESCE(med.valor,0) + COALESCE(ped.receita,0)
   - COALESCE(ped.cmv,0) - COALESCE(via.valor,0))::numeric(15,2) AS margem_realizada
FROM public.projetos_obras o
LEFT JOIN (
  SELECT obra_id,
         SUM(quantidade_contratada * COALESCE(custo_unitario_previsto,0)) AS custo_previsto,
         SUM(valor_contratado) AS valor_contratado
  FROM public.projetos_obra_item WHERE excluido_em IS NULL GROUP BY obra_id
) prev ON prev.obra_id = o.id
LEFT JOIN (
  SELECT obra_id, SUM(valor) AS valor FROM public.erp_nfse_obra_medicao
  WHERE estornada_em IS NULL AND descartada_em IS NULL GROUP BY obra_id
) med ON med.obra_id = o.id
LEFT JOIN (
  SELECT obra_id, SUM(total) AS receita, SUM(COALESCE(cmv,0)) AS cmv
  FROM public.erp_pedidos WHERE obra_id IS NOT NULL
    AND COALESCE(status,'') NOT IN ('cancelado','cancelada') GROUP BY obra_id
) ped ON ped.obra_id = o.id
LEFT JOIN (
  SELECT obra_id, SUM(custo_total) AS valor FROM public.v_viagem_custo_obra GROUP BY obra_id
) via ON via.obra_id = o.id;

REVOKE ALL ON public.v_obra_resultado FROM anon, PUBLIC;
GRANT SELECT ON public.v_obra_resultado TO authenticated;

-- ── 5) gravar as obras/pesos do rateio de uma viagem aberta (substitui o conjunto; lista vazia = sem rateio) ────
--   p_dados = { "criterio": "km"|"dias"|"percentual", "obras": [ { "obra_id": "...", "peso": 120 }, ... ] }
--   percentual: os pesos somam 100.
CREATE OR REPLACE FUNCTION public.fn_viagem_rateio_salvar(p_viagem_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_v     public.erp_viagem%ROWTYPE;
  v_crit  text := COALESCE(NULLIF(btrim(p_dados->>'criterio'), ''), 'km');
  v_obras jsonb := COALESCE(p_dados->'obras', '[]'::jsonb);
  v_erros text[] := ARRAY[]::text[];
  v_soma  numeric;
  r       record;
BEGIN
  SELECT * INTO v_v FROM public.erp_viagem WHERE id = p_viagem_id FOR UPDATE;
  IF NOT FOUND OR v_v.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Viagem não encontrada'); END IF;
  PERFORM public.fn__guarda_empresa(v_v.company_id);
  IF v_v.status <> 'aberta' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Viagem fechada não se altera'); END IF;
  IF jsonb_typeof(v_obras) <> 'array' THEN RETURN jsonb_build_object('ok', false, 'erro', 'obras: lista de { obra_id, peso }'); END IF;
  IF v_crit NOT IN ('km', 'dias', 'percentual') THEN v_erros := array_append(v_erros, 'critério: km, dias ou percentual'::text); END IF;

  FOR r IN SELECT NULLIF(e->>'obra_id', '')::uuid AS obra_id, NULLIF(e->>'peso', '')::numeric AS peso FROM jsonb_array_elements(v_obras) e LOOP
    IF r.obra_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.projetos_obras o WHERE o.id = r.obra_id AND o.company_id = v_v.company_id) THEN
      v_erros := array_append(v_erros, 'obra: não é desta empresa'::text);
    END IF;
    IF r.peso IS NULL OR r.peso <= 0 THEN v_erros := array_append(v_erros, 'peso: maior que zero'::text); END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(v_obras)) <> (SELECT count(DISTINCT e->>'obra_id') FROM jsonb_array_elements(v_obras) e) THEN
    v_erros := array_append(v_erros, 'obra: repetida na lista'::text);
  END IF;
  IF v_crit = 'percentual' AND jsonb_array_length(v_obras) > 0 THEN
    SELECT sum(NULLIF(e->>'peso', '')::numeric) INTO v_soma FROM jsonb_array_elements(v_obras) e;
    IF v_soma IS DISTINCT FROM 100 THEN v_erros := array_append(v_erros, format('percentual: os pesos somam %s, devem somar 100', v_soma)); END IF;
  END IF;
  IF array_length(v_erros, 1) > 0 THEN RETURN jsonb_build_object('ok', false, 'erros', to_jsonb(v_erros)); END IF;

  UPDATE public.erp_viagem_obra SET excluido_em = now(), excluido_por = auth.uid()
   WHERE viagem_id = p_viagem_id AND excluido_em IS NULL;
  INSERT INTO public.erp_viagem_obra (company_id, viagem_id, obra_id, criterio, peso, criado_por)
  SELECT v_v.company_id, p_viagem_id, (e->>'obra_id')::uuid, v_crit, (e->>'peso')::numeric, auth.uid()
    FROM jsonb_array_elements(v_obras) e;
  UPDATE public.erp_viagem SET atualizado_em = now() WHERE id = p_viagem_id;
  RETURN jsonb_build_object('ok', true, 'criterio', v_crit, 'obras', jsonb_array_length(v_obras));
END $function$;
REVOKE ALL ON FUNCTION public.fn_viagem_rateio_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_viagem_rateio_salvar(uuid, jsonb) TO authenticated, service_role;

-- marcar/desmarcar um cupom como compartilhado (viagem aberta)
CREATE OR REPLACE FUNCTION public.fn_viagem_lancamento_rateio(p_id uuid, p_rateio boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_l public.erp_viagem_lancamento%ROWTYPE; v_status text;
BEGIN
  SELECT * INTO v_l FROM public.erp_viagem_lancamento WHERE id = p_id;
  IF NOT FOUND OR v_l.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Lançamento não encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(v_l.company_id);
  SELECT status INTO v_status FROM public.erp_viagem WHERE id = v_l.viagem_id;
  IF v_status <> 'aberta' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Viagem fechada não se altera'); END IF;
  UPDATE public.erp_viagem_lancamento SET rateio = COALESCE(p_rateio, false) WHERE id = p_id;
  UPDATE public.erp_viagem SET atualizado_em = now() WHERE id = v_l.viagem_id;
  RETURN jsonb_build_object('ok', true, 'rateio', COALESCE(p_rateio, false));
END $function$;
REVOKE ALL ON FUNCTION public.fn_viagem_lancamento_rateio(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_viagem_lancamento_rateio(uuid, boolean) TO authenticated, service_role;

-- ── 6) relatório de custo: por viagem e por obra, com a conferência 1:1 contra o Resultado da obra ────────────
--   Período = viagens cuja saída cai entre p_ini e p_fim (NULL = sem limite). p_obra_id filtra as viagens que
--   tocaram a obra. Mesmas contas do fn_viagem_resumo: km = final − inicial; custo/km = total ÷ km;
--   consumo = km ÷ litros; saldo = adiantamento − pago pelo colaborador.
--   Conferência: Σ custo_total da v_viagem_custo_obra por obra = v_obra_resultado.custo_viagens (todas as viagens).
CREATE OR REPLACE FUNCTION public.fn_viagem_relatorio(p_company_id uuid, p_ini date DEFAULT NULL, p_fim date DEFAULT NULL, p_obra_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  WITH vg AS (
    SELECT v.* FROM public.erp_viagem v
     WHERE v.company_id = p_company_id AND v.excluido_em IS NULL AND v.status <> 'cancelada'
       AND (p_ini IS NULL OR v.periodo_inicio >= p_ini)
       AND (p_fim IS NULL OR v.periodo_inicio <= p_fim)
       AND (p_obra_id IS NULL OR v.obra_id = p_obra_id
            OR EXISTS (SELECT 1 FROM public.v_viagem_custo_obra c WHERE c.viagem_id = v.id AND c.obra_id = p_obra_id))
  ),
  lt AS (
    SELECT l.viagem_id,
           round(COALESCE(sum(l.valor), 0), 2) AS total,
           round(COALESCE(sum(l.valor) FILTER (WHERE l.tipo = 'abastecimento'), 0), 2) AS combustivel,
           round(COALESCE(sum(l.valor) FILTER (WHERE l.pago_colaborador), 0), 2) AS pago_colaborador,
           round(COALESCE(sum(l.litros) FILTER (WHERE l.tipo = 'abastecimento'), 0), 3) AS litros,
           round(COALESCE(sum(l.valor) FILTER (WHERE l.rateio), 0), 2) AS compartilhado,
           count(*) AS lancamentos
      FROM public.erp_viagem_lancamento l JOIN vg ON vg.id = l.viagem_id
     WHERE l.excluido_em IS NULL
     GROUP BY l.viagem_id
  ),
  co AS (
    SELECT c.* FROM public.v_viagem_custo_obra c JOIN vg ON vg.id = c.viagem_id
  ),
  por_viagem AS (
    SELECT vg.id, vg.numero, vg.colaborador_nome, vg.placa, vg.periodo_inicio, vg.periodo_fim, vg.status, vg.origem, vg.destino,
           vg.obra_id, vg.adiantamento,
           CASE WHEN vg.km_inicial IS NOT NULL AND vg.km_final IS NOT NULL AND vg.km_final >= vg.km_inicial
                THEN vg.km_final - vg.km_inicial END AS km,
           COALESCE(lt.total, 0) AS total, COALESCE(lt.combustivel, 0) AS combustivel,
           COALESCE(lt.pago_colaborador, 0) AS pago_colaborador, COALESCE(lt.litros, 0) AS litros,
           COALESCE(lt.compartilhado, 0) AS compartilhado, COALESCE(lt.lancamentos, 0) AS lancamentos
      FROM vg LEFT JOIN lt ON lt.viagem_id = vg.id
  ),
  obras_alvo AS (
    SELECT DISTINCT obra_id FROM co WHERE p_obra_id IS NULL OR obra_id = p_obra_id
  ),
  por_obra AS (
    SELECT o.id AS obra_id, o.numero, o.nome,
           COALESCE((SELECT sum(c.custo_total) FROM co c WHERE c.obra_id = o.id), 0)::numeric(15,2) AS custo_periodo,
           COALESCE((SELECT sum(c.custo_direto) FROM co c WHERE c.obra_id = o.id), 0)::numeric(15,2) AS custo_direto,
           COALESCE((SELECT sum(c.custo_rateado) FROM co c WHERE c.obra_id = o.id), 0)::numeric(15,2) AS custo_rateado,
           COALESCE((SELECT count(DISTINCT c.viagem_id) FROM co c WHERE c.obra_id = o.id), 0) AS viagens,
           COALESCE((SELECT sum(t.custo_total) FROM public.v_viagem_custo_obra t WHERE t.obra_id = o.id), 0)::numeric(15,2) AS custo_todas_viagens,
           COALESCE((SELECT r.custo_viagens FROM public.v_obra_resultado r WHERE r.obra_id = o.id), 0)::numeric(15,2) AS custo_no_resultado
      FROM public.projetos_obras o JOIN obras_alvo a ON a.obra_id = o.id
     WHERE o.company_id = p_company_id
  )
  SELECT jsonb_build_object(
    'company_id', p_company_id, 'periodo_inicio', p_ini, 'periodo_fim', p_fim, 'obra_id', p_obra_id,
    'viagens', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'viagem_id', pv.id, 'numero', pv.numero, 'colaborador', pv.colaborador_nome, 'placa', pv.placa,
        'periodo_inicio', pv.periodo_inicio, 'periodo_fim', pv.periodo_fim, 'status', pv.status,
        'origem', pv.origem, 'destino', pv.destino, 'obra_principal_id', pv.obra_id,
        'total', pv.total, 'combustivel', pv.combustivel, 'compartilhado', pv.compartilhado,
        'km_rodado', pv.km, 'litros', pv.litros,
        'custo_km', CASE WHEN pv.km > 0 THEN round(pv.total / pv.km, 2) END,
        'media_km_l', CASE WHEN pv.km IS NOT NULL AND pv.litros > 0 THEN round(pv.km / pv.litros, 2) END,
        'adiantamento', pv.adiantamento, 'pago_colaborador', pv.pago_colaborador,
        'saldo', round(pv.adiantamento - pv.pago_colaborador, 2),
        'lancamentos', pv.lancamentos,
        'obras', COALESCE((SELECT jsonb_agg(jsonb_build_object('obra_id', c.obra_id, 'custo_direto', c.custo_direto,
                    'custo_rateado', c.custo_rateado, 'custo_total', c.custo_total) ORDER BY c.custo_total DESC)
                  FROM co c WHERE c.viagem_id = pv.id), '[]'::jsonb))
      ORDER BY pv.periodo_inicio DESC, pv.numero DESC) FROM por_viagem pv), '[]'::jsonb),
    'obras', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'obra_id', po.obra_id, 'numero', po.numero, 'nome', po.nome, 'viagens', po.viagens,
        'custo_periodo', po.custo_periodo, 'custo_direto', po.custo_direto, 'custo_rateado', po.custo_rateado,
        'custo_todas_viagens', po.custo_todas_viagens, 'custo_no_resultado', po.custo_no_resultado,
        'confere', po.custo_todas_viagens = po.custo_no_resultado) ORDER BY po.custo_periodo DESC) FROM por_obra po), '[]'::jsonb),
    'totais', jsonb_build_object(
        'viagens', (SELECT count(*) FROM por_viagem),
        'total', COALESCE((SELECT sum(total) FROM por_viagem), 0),
        'km_rodado', COALESCE((SELECT sum(km) FROM por_viagem), 0),
        'custo_km', (SELECT CASE WHEN sum(km) > 0 THEN round(sum(total) FILTER (WHERE km IS NOT NULL) / sum(km), 2) END FROM por_viagem),
        'por_obra', COALESCE((SELECT sum(custo_total) FROM co WHERE p_obra_id IS NULL OR obra_id = p_obra_id), 0)),
    'confere', COALESCE((SELECT bool_and(po.custo_todas_viagens = po.custo_no_resultado) FROM por_obra po), true)
  )
$function$;
REVOKE ALL ON FUNCTION public.fn_viagem_relatorio(uuid, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_viagem_relatorio(uuid, date, date, uuid) TO authenticated, service_role;

-- ── 7) "?" dos campos novos (RD-95) ──────────────────────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/viagens', 'hub_construcao', 'publicado'
FROM (VALUES
  ('projetos.viagem.lanc_rateio', 'Lançamento', 'Dividir entre as obras', 'Marque quando o gasto serviu a todas as obras da viagem (combustível, pedágio, hotel da equipe).', 'O valor é dividido entre as obras da viagem pelo peso de cada uma; sem a marca, fica inteiro na obra do cupom.', 'Pedágio da ida, viagem que atendeu duas obras', 'Marcar um gasto que foi só de uma obra: ele se espalha pelas outras.', 19),
  ('projetos.viagem.rateio_criterio', 'Rateio', 'Como dividir', 'Por km rodado em cada obra, por dias em cada obra ou por percentual.', 'Define a proporção com que os gastos compartilhados caem em cada obra.', 'Dias: 3 dias na obra A e 2 na obra B', 'Escolher percentual e os números não somarem 100: o sistema recusa.', 20),
  ('projetos.viagem.rateio_obra', 'Rateio', 'Obras atendidas', 'Cada obra que a viagem atendeu.', 'Só as obras desta lista recebem parte dos gastos compartilhados.', 'Obra 0153 · Galpão e Obra 0160 · Piso', 'Esquecer uma obra: ela fica sem o custo da viagem e a margem dela sai maior do que é.', 21),
  ('projetos.viagem.rateio_peso', 'Rateio', 'Peso da obra', 'O km, os dias ou o percentual de cada obra, conforme o critério.', 'A obra recebe a parte proporcional ao seu peso; os centavos que sobram vão para a obra de maior peso.', '60 (de 100%)', 'Trocar km por dias na mesma viagem: a divisão fica errada.', 22),
  ('projetos.viagem.rel_total', 'Relatório', 'Custo da viagem', 'Calculado: a soma de todos os cupons da viagem.', 'É o que a viagem custou, antes de dividir entre as obras.', 'R$ 2.340,00', 'Cupom lançado duas vezes: o custo dobra.', 23),
  ('projetos.viagem.rel_custo_km', 'Relatório', 'Custo por km', 'Calculado: custo da viagem ÷ km rodado (km final − km inicial).', 'Compara viagens e veículos e ajuda a orçar o deslocamento das próximas obras.', 'R$ 2,53 por km', 'Km inicial ou final em branco: o custo por km não aparece.', 24),
  ('projetos.viagem.rel_custo_obra', 'Relatório', 'Custo de viagem na obra', 'Calculado: o que cada obra recebeu das viagens (direto + parte dividida).', 'É o mesmo número da coluna Viagens no Resultado da obra.', 'R$ 1.404,00', 'Cupom na obra errada: o custo aparece na obra errada.', 25),
  ('projetos.viagem.rel_confere', 'Relatório', 'Confere com o Resultado', 'Calculado: compara o custo de viagem da obra com o Resultado da obra.', 'Prova que o relatório e o Resultado saem da mesma conta, centavo a centavo.', 'Confere', 'Se aparecer "não confere", avise o suporte: é sinal de erro de cálculo.', 26)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
