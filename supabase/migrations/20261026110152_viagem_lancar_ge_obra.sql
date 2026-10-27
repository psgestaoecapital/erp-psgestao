-- Viagem · onda 2: lançamento no GE da viagem fechada, centro de custo = obra (Eng. Chefe 24/10, autorizado na caixa
-- 9c047749 · desenvolvedor_4_g, faixa 52). SÓ ADITIVO: uma tabela de vínculo nova e uma função nova; nenhuma função ou
-- tabela financeira existente muda, nenhum dado de cliente é alterado ou apagado (só INSERT de títulos novos).
--
-- O que a função faz (fn_viagem_lancar_ge), para uma viagem FECHADA, uma vez só:
--   1) parte cada cupom pelas obras com a MESMA conta da v_viagem_custo_obra (cota em centavos; a sobra vai para a obra
--      de maior peso) → Σ dos títulos por obra = custo de viagem da obra no Resultado, centavo a centavo (confere no fim;
--      se não bater, nada é gravado);
--   2) cria um título no contas a pagar (erp_pagar) por pedaço, com a categoria do cupom e o centro de custo da obra:
--        · pago pela empresa (cartão da empresa, pix, dinheiro da empresa) → pago na data do cupom;
--        · a prazo → em aberto para o fornecedor, vence 30 dias depois do cupom (o financeiro ajusta no contas a pagar);
--        · pago pelo colaborador → pago na data do cupom até o valor do adiantamento (o dinheiro já saiu no adiantamento);
--          o que passar do adiantamento fica em aberto para o COLABORADOR (é o reembolso do acerto), vence no fechamento;
--      assim o caixa não conta duas vezes: o colaborador recebe só o que gastou além do adiantamento;
--   3) se o adiantamento foi maior que o gasto do colaborador, a devolução aparece no retorno (a_devolver) e no relatório
--      (saldo do acerto); não nasce título, porque o dinheiro volta para a empresa.
-- Autoria: auth.uid() (usuário logado, perfil que grava); rotina/serviço sem usuário não lança.
-- O Resultado da obra NÃO muda: ele já lê a v_viagem_custo_obra; o título serve ao financeiro (caixa, DRE por centro).

-- ── 1) vínculo viagem × título do GE (um pedaço de cupom por obra e situação; impede lançar duas vezes) ──────────
CREATE TABLE IF NOT EXISTS public.erp_viagem_ge_titulo (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  viagem_id      uuid NOT NULL REFERENCES public.erp_viagem(id) ON DELETE CASCADE,
  lancamento_id  uuid NOT NULL REFERENCES public.erp_viagem_lancamento(id),
  obra_id        uuid NOT NULL REFERENCES public.projetos_obras(id),
  situacao       text NOT NULL CHECK (situacao IN ('pago_empresa', 'a_prazo', 'coberto_adiantamento', 'reembolso_colaborador')),
  valor          numeric(15,2) NOT NULL CHECK (valor > 0),
  pagar_id       uuid NOT NULL REFERENCES public.erp_pagar(id),
  criado_por     uuid NOT NULL,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lancamento_id, obra_id, situacao)
);
CREATE INDEX IF NOT EXISTS erp_viagem_ge_titulo_viagem_idx ON public.erp_viagem_ge_titulo (viagem_id);

ALTER TABLE public.erp_viagem_ge_titulo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_viagem_ge_titulo FROM PUBLIC, anon;
DROP POLICY IF EXISTS erp_viagem_ge_titulo_ler ON public.erp_viagem_ge_titulo;
CREATE POLICY erp_viagem_ge_titulo_ler ON public.erp_viagem_ge_titulo FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
GRANT SELECT ON public.erp_viagem_ge_titulo TO authenticated;

-- ── 2) lançar a viagem fechada no GE ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_viagem_lancar_ge(p_viagem_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_v        public.erp_viagem%ROWTYPE;
  v_uid      uuid := auth.uid();
  v_cobrir   numeric;          -- quanto do gasto do colaborador o adiantamento ainda cobre
  v_pago_col numeric;
  v_fech     date;
  v_parte    numeric;
  v_resto    numeric;
  v_pagar    uuid;
  v_titulos  integer := 0;
  v_total    numeric := 0;
  v_reemb    numeric := 0;
  v_aprazo   numeric := 0;
  v_dif      integer;
  r          record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre com o seu usuário para lançar no GE'); END IF;
  SELECT * INTO v_v FROM public.erp_viagem WHERE id = p_viagem_id FOR UPDATE;
  IF NOT FOUND OR v_v.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Viagem não encontrada'); END IF;
  PERFORM public.fn__guarda_empresa(v_v.company_id);
  IF NOT public.fn_viagem_pode_gravar(v_v.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Perfil de consulta não lança no GE');
  END IF;
  IF v_v.status <> 'fechada' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Feche a viagem antes de lançar no GE'); END IF;
  IF EXISTS (SELECT 1 FROM public.erp_viagem_ge_titulo WHERE viagem_id = p_viagem_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Viagem já lançada no GE',
      'titulos', (SELECT count(*) FROM public.erp_viagem_ge_titulo WHERE viagem_id = p_viagem_id));
  END IF;
  IF EXISTS (SELECT 1 FROM public.erp_viagem_lancamento l JOIN public.projetos_obras o ON o.id = l.obra_id
              WHERE l.viagem_id = p_viagem_id AND l.excluido_em IS NULL AND o.centro_custo_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.erp_viagem_obra x JOIN public.projetos_obras o ON o.id = x.obra_id
              WHERE x.viagem_id = p_viagem_id AND x.excluido_em IS NULL AND o.centro_custo_id IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Obra da viagem sem centro de custo: cadastre o centro na obra');
  END IF;

  SELECT COALESCE(sum(valor), 0) INTO v_pago_col FROM public.erp_viagem_lancamento
   WHERE viagem_id = p_viagem_id AND excluido_em IS NULL AND pago_colaborador;
  v_cobrir := LEAST(v_v.adiantamento, v_pago_col);
  v_fech   := COALESCE(v_v.fechada_em::date, CURRENT_DATE);

  -- pedaços (cupom × obra): mesma conta da v_viagem_custo_obra
  FOR r IN
    WITH l AS (
      SELECT x.* FROM public.erp_viagem_lancamento x WHERE x.viagem_id = p_viagem_id AND x.excluido_em IS NULL
    ),
    p AS (
      SELECT o.obra_id, o.peso, sum(o.peso) OVER () AS peso_total,
             row_number() OVER (ORDER BY o.peso DESC, o.obra_id) AS ordem
        FROM public.erp_viagem_obra o WHERE o.viagem_id = p_viagem_id AND o.excluido_em IS NULL
    ),
    pedaco AS (
      SELECT l.id, l.obra_id, l.valor AS cota, 1::bigint AS ordem
        FROM l WHERE NOT l.rateio OR NOT EXISTS (SELECT 1 FROM p)
      UNION ALL
      SELECT l.id, p.obra_id, round(l.valor * p.peso / p.peso_total, 2), p.ordem
        FROM l JOIN p ON true WHERE l.rateio
    ),
    acerto AS (
      SELECT pd.id, pd.obra_id,
             pd.cota + CASE WHEN pd.ordem = 1 THEN l.valor - sum(pd.cota) OVER (PARTITION BY pd.id) ELSE 0 END AS valor
        FROM pedaco pd JOIN l ON l.id = pd.id
    )
    SELECT a.obra_id, a.valor AS cota, l.id AS lancamento_id, l.data, l.fornecedor_nome, l.categoria, l.documento,
           l.forma_pagamento, l.pago_colaborador, o.numero AS obra_numero, o.centro_custo_id
      FROM acerto a JOIN l ON l.id = a.id JOIN public.projetos_obras o ON o.id = a.obra_id
     WHERE a.valor > 0
     ORDER BY l.data, l.criado_em, l.id, a.obra_id
  LOOP
    IF r.forma_pagamento = 'a_prazo' AND NOT r.pago_colaborador THEN
      INSERT INTO public.erp_pagar (company_id, fornecedor_nome, descricao, categoria, valor, data_emissao, data_competencia,
             data_vencimento, status, forma_pagamento, numero_documento, centro_custo_id, observacoes,
             ref_externa_sistema, ref_externa_id)
      VALUES (v_v.company_id, r.fornecedor_nome, format('Viagem %s · %s · obra %s', v_v.numero, r.fornecedor_nome, r.obra_numero),
             r.categoria, r.cota, r.data, r.data, r.data + 30, 'aberto', r.forma_pagamento, r.documento, r.centro_custo_id,
             format('Cupom a prazo da viagem %s (%s). Vencimento sugerido: 30 dias; ajuste aqui se o prazo for outro.', v_v.numero, v_v.colaborador_nome),
             'viagem', format('%s:%s:a_prazo', r.lancamento_id, r.obra_id))
      RETURNING id INTO v_pagar;
      INSERT INTO public.erp_viagem_ge_titulo (company_id, viagem_id, lancamento_id, obra_id, situacao, valor, pagar_id, criado_por)
      VALUES (v_v.company_id, p_viagem_id, r.lancamento_id, r.obra_id, 'a_prazo', r.cota, v_pagar, v_uid);
      v_titulos := v_titulos + 1; v_aprazo := v_aprazo + r.cota;
    ELSIF NOT r.pago_colaborador THEN
      INSERT INTO public.erp_pagar (company_id, fornecedor_nome, descricao, categoria, valor, valor_pago, data_emissao, data_competencia,
             data_vencimento, data_pagamento, status, forma_pagamento, numero_documento, centro_custo_id, origem_baixa, baixado_por,
             observacoes, ref_externa_sistema, ref_externa_id)
      VALUES (v_v.company_id, r.fornecedor_nome, format('Viagem %s · %s · obra %s', v_v.numero, r.fornecedor_nome, r.obra_numero),
             r.categoria, r.cota, r.cota, r.data, r.data, r.data, r.data, 'pago', r.forma_pagamento, r.documento, r.centro_custo_id,
             'manual', v_uid, format('Pago pela empresa na viagem %s (%s).', v_v.numero, v_v.colaborador_nome),
             'viagem', format('%s:%s:pago_empresa', r.lancamento_id, r.obra_id))
      RETURNING id INTO v_pagar;
      INSERT INTO public.erp_viagem_ge_titulo (company_id, viagem_id, lancamento_id, obra_id, situacao, valor, pagar_id, criado_por)
      VALUES (v_v.company_id, p_viagem_id, r.lancamento_id, r.obra_id, 'pago_empresa', r.cota, v_pagar, v_uid);
      v_titulos := v_titulos + 1;
    ELSE
      -- pago pelo colaborador: primeiro o que o adiantamento cobre (já pago), depois o reembolso em aberto
      v_parte := LEAST(v_cobrir, r.cota);
      v_resto := r.cota - v_parte;
      v_cobrir := v_cobrir - v_parte;
      IF v_parte > 0 THEN
        INSERT INTO public.erp_pagar (company_id, fornecedor_nome, descricao, categoria, valor, valor_pago, data_emissao, data_competencia,
               data_vencimento, data_pagamento, status, forma_pagamento, numero_documento, centro_custo_id, origem_baixa, baixado_por,
               observacoes, ref_externa_sistema, ref_externa_id)
        VALUES (v_v.company_id, r.fornecedor_nome, format('Viagem %s · %s · obra %s', v_v.numero, r.fornecedor_nome, r.obra_numero),
               r.categoria, v_parte, v_parte, r.data, r.data, r.data, r.data, 'pago', r.forma_pagamento, r.documento, r.centro_custo_id,
               'manual', v_uid, format('Pago pelo colaborador %s com o adiantamento da viagem %s.', v_v.colaborador_nome, v_v.numero),
               'viagem', format('%s:%s:coberto_adiantamento', r.lancamento_id, r.obra_id))
        RETURNING id INTO v_pagar;
        INSERT INTO public.erp_viagem_ge_titulo (company_id, viagem_id, lancamento_id, obra_id, situacao, valor, pagar_id, criado_por)
        VALUES (v_v.company_id, p_viagem_id, r.lancamento_id, r.obra_id, 'coberto_adiantamento', v_parte, v_pagar, v_uid);
        v_titulos := v_titulos + 1;
      END IF;
      IF v_resto > 0 THEN
        INSERT INTO public.erp_pagar (company_id, fornecedor_nome, descricao, categoria, valor, data_emissao, data_competencia,
               data_vencimento, status, forma_pagamento, numero_documento, centro_custo_id, observacoes,
               ref_externa_sistema, ref_externa_id)
        VALUES (v_v.company_id, v_v.colaborador_nome, format('Viagem %s · reembolso a %s · %s · obra %s', v_v.numero, v_v.colaborador_nome, r.fornecedor_nome, r.obra_numero),
               r.categoria, v_resto, r.data, r.data, v_fech, 'aberto', 'pix', r.documento, r.centro_custo_id,
               format('Reembolso do acerto da viagem %s: o colaborador pagou além do adiantamento.', v_v.numero),
               'viagem', format('%s:%s:reembolso_colaborador', r.lancamento_id, r.obra_id))
        RETURNING id INTO v_pagar;
        INSERT INTO public.erp_viagem_ge_titulo (company_id, viagem_id, lancamento_id, obra_id, situacao, valor, pagar_id, criado_por)
        VALUES (v_v.company_id, p_viagem_id, r.lancamento_id, r.obra_id, 'reembolso_colaborador', v_resto, v_pagar, v_uid);
        v_titulos := v_titulos + 1; v_reemb := v_reemb + v_resto;
      END IF;
    END IF;
    v_total := v_total + r.cota;
  END LOOP;

  -- conferência 1:1: Σ dos títulos por obra = custo de viagem da obra na fonte única (a mesma do Resultado)
  SELECT count(*) INTO v_dif FROM (
    SELECT COALESCE(t.obra_id, c.obra_id) AS obra_id
      FROM (SELECT obra_id, sum(valor) AS v FROM public.erp_viagem_ge_titulo WHERE viagem_id = p_viagem_id GROUP BY obra_id) t
      FULL JOIN (SELECT obra_id, custo_total AS v FROM public.v_viagem_custo_obra WHERE viagem_id = p_viagem_id) c ON c.obra_id = t.obra_id
     WHERE COALESCE(t.v, 0) <> COALESCE(c.v, 0)) d;
  IF v_dif > 0 THEN
    RAISE EXCEPTION 'Lançamento da viagem % não confere com o custo por obra (% obra(s) divergentes); nada foi gravado', v_v.numero, v_dif;
  END IF;

  RETURN jsonb_build_object('ok', true, 'viagem', v_v.numero, 'titulos', v_titulos, 'total', round(v_total, 2),
    'a_prazo', round(v_aprazo, 2), 'reembolso_colaborador', round(v_reemb, 2),
    'a_devolver', round(GREATEST(v_v.adiantamento - v_pago_col, 0), 2),
    'obras', COALESCE((SELECT jsonb_agg(jsonb_build_object('obra_id', obra_id, 'valor', v) ORDER BY v DESC)
               FROM (SELECT obra_id, sum(valor) AS v FROM public.erp_viagem_ge_titulo WHERE viagem_id = p_viagem_id GROUP BY obra_id) s), '[]'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public.fn_viagem_lancar_ge(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_viagem_lancar_ge(uuid) TO authenticated, service_role;

-- ── 3) "?" dos campos novos da tela (RD-95) ──────────────────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/viagens', 'hub_construcao', 'publicado'
FROM (VALUES
  ('projetos.viagem.ge_lancar', 'GE', 'Lançar no GE', 'Clique depois de fechar a viagem. Só se lança uma vez.', 'Cria no contas a pagar um título por cupom e obra, no centro de custo da obra: pago pela empresa já entra pago; a prazo fica em aberto 30 dias; o que o colaborador pagou além do adiantamento fica em aberto como reembolso.', 'Viagem 3 · 5 títulos · R$ 2.460,35', 'Lançar antes de conferir os cupons: depois de lançada, a correção é feita no contas a pagar.', 40),
  ('projetos.viagem.ge_situacao', 'GE', 'Situação no GE', 'Calculado: se a viagem fechada já tem os títulos no contas a pagar.', 'Mostra o que falta levar ao financeiro.', 'Lançada no GE · 5 títulos', 'Viagem fechada e não lançada: o custo está no Resultado da obra, mas o caixa não sabe do reembolso.', 41),
  ('projetos.viagem.ge_a_devolver', 'GE', 'A devolver pelo colaborador', 'Calculado: adiantamento menos o que o colaborador pagou, quando sobra.', 'É o dinheiro que volta para a empresa; não vira título a pagar.', 'R$ 746,73', 'Esquecer de cobrar a devolução: o adiantamento fica em aberto com o colaborador.', 42),
  ('projetos.viagem.rel_periodo', 'Relatório', 'Período', 'Datas de saída das viagens que entram no relatório (em branco = todas).', 'Recorta as viagens; a conferência com o Resultado da obra é sempre pelo total.', '01/10/2026 a 31/10/2026', 'Esperar que o custo no Resultado mude com o período: ele é o total da obra.', 43),
  ('projetos.viagem.rel_obra', 'Relatório', 'Obra', 'Escolha uma obra para ver só as viagens que a atenderam (em branco = todas).', 'Mostra quanto cada obra recebeu de custo de viagem.', 'DEMO-FC-001 · Piso industrial', 'Filtrar a obra e somar o total da viagem: a viagem pode ter atendido outras obras.', 44),
  ('projetos.viagem.rel_viagens', 'Relatório', 'Viagens', 'Calculado: quantas viagens atenderam a obra no período.', 'Ajuda a ver quais obras puxam mais deslocamento.', '2 viagens', 'Viagem cancelada não conta.', 45),
  ('projetos.viagem.rel_km', 'Relatório', 'Km rodado', 'Calculado: km final menos km inicial de cada viagem.', 'Base do custo por km.', '608 km', 'Km em branco na viagem: ela fica fora do custo por km.', 46)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
