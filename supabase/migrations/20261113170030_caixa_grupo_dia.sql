-- Caixa do dia do grupo (Item 5 F1 — CEO/Júlia na P2, contexto 2a3909d9; tarefa d2c0b81a)
-- Tela nova GE > Financeiro (/dashboard/financeiro/caixa-grupo), SÓ LEITURA. Genérico p/ qualquer grupo
-- (companies.group_id). Para cada empresa do grupo e no consolidado, por conta bancária e no dia escolhido:
--   saldo inicial (fim do dia anterior), entradas do dia (recebimentos baixados), saídas do dia
--   (pagamentos baixados), transferências do dia e saldo final; + bloco "o que vence" (hoje/atrasado/7 dias).
-- A linkage (receber por conta_bancaria_id; pagar por nome único de conta; corte histórico; "Sem conta";
-- transferências) é a MESMA de fn_saldo_gerencial_contas — aqui só se adiciona o bucket por data (prova RD-38:
-- a soma por conta sem filtro de data bate 100% com fn_saldo_gerencial_contas).
-- Transferências: erp_transferencia é SEMPRE intra-empresa (1 company_id, 2 contas DELA); não há transferência
-- ENTRE empresas no modelo, então o consolidado é soma limpa (as pernas intra-empresa se anulam).
-- F2 (fechamento do dia) fica para a próxima fatia.

-- ── Núcleo: CTEs de linkage por conta, com bucket de data (< p_data = inicial, = p_data = dia) ───────────────
CREATE OR REPLACE FUNCTION public.fn_caixa_grupo_dia(p_company_ids uuid[], p_data date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_ids uuid[];
  v_empresas jsonb;
  v_cons jsonb;
  v_vence jsonb;
  v_atrasados int;
  v_resumo text;
BEGIN
  -- Fail-closed por empresa: sem JWT = chamada interna; service_role passa; logado só vê as suas (RLS).
  IF coalesce(current_setting('request.jwt.claims', true), '') = '' OR auth.role() = 'service_role' THEN
    v_ids := p_company_ids;
  ELSE
    SELECT array_agg(x) INTO v_ids FROM unnest(p_company_ids) x WHERE x IN (SELECT get_user_company_ids());
  END IF;
  IF v_ids IS NULL OR array_length(v_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'data', p_data, 'empresas', '[]'::jsonb,
      'consolidado', jsonb_build_object('saldo_inicial',0,'entradas',0,'saidas',0,'transf',0,'saldo_final',0),
      'vence', jsonb_build_object('receber', jsonb_build_object('hoje',0,'atrasado',0,'proximos7',0),
                                  'pagar',   jsonb_build_object('hoje',0,'atrasado',0,'proximos7',0)),
      'atrasados_n', 0, 'resumo', 'Nenhuma empresa acessível para o seu usuário.');
  END IF;

  WITH contas AS (
    SELECT bc.id, bc.company_id AS cid, bc.nome::text AS nm, lower(btrim(bc.nome)) AS nkey,
           COALESCE(bc.saldo_inicial,0) AS si, COALESCE(bc.data_saldo_inicial,'1900-01-01'::date) AS dsi
    FROM erp_banco_contas bc WHERE bc.company_id = ANY(v_ids) AND bc.ativo = true
  ),
  nkey_ct AS (SELECT c.cid, c.nkey, count(*) AS n FROM contas c GROUP BY 1,2),
  rbx AS (SELECT b.receber_id AS tid, b.valor, b.data FROM erp_receber_baixa b WHERE b.company_id = ANY(v_ids) AND b.deleted_at IS NULL),
  pbx AS (SELECT b.pagar_id AS tid, b.valor, b.data FROM erp_pagar_baixa b WHERE b.company_id = ANY(v_ids) AND b.deleted_at IS NULL),
  rtem AS (SELECT DISTINCT tid FROM rbx),
  ptem AS (SELECT DISTINCT tid FROM pbx),
  rtit AS (
    SELECT er.id, er.company_id AS cid, er.conta_bancaria_id AS conta, er.valor_pago, er.valor, er.data_pagamento, er.data_vencimento AS venc,
           (rt.tid IS NOT NULL) AS tem_baixa
    FROM erp_receber er LEFT JOIN rtem rt ON rt.tid = er.id
    WHERE er.company_id = ANY(v_ids) AND er.deleted_at IS NULL
      AND ( (rt.tid IS NOT NULL AND er.status IN ('recebido','pago','parcial'))
         OR (rt.tid IS NULL AND er.status IN ('recebido','pago') AND er.data_pagamento IS NOT NULL) )
  ),
  ptit AS (
    SELECT ep.id, ep.company_id AS cid, lower(btrim(ep.conta_bancaria)) AS nkey, ep.valor_pago, ep.valor, ep.data_pagamento, ep.data_vencimento AS venc,
           (pt.tid IS NOT NULL) AS tem_baixa
    FROM erp_pagar ep LEFT JOIN ptem pt ON pt.tid = ep.id
    WHERE ep.company_id = ANY(v_ids) AND ep.deleted_at IS NULL
      AND ( (pt.tid IS NOT NULL AND ep.status IN ('pago','parcial'))
         OR (pt.tid IS NULL AND ep.status = 'pago' AND ep.data_pagamento IS NOT NULL) )
  ),
  rlan0 AS (
    SELECT t.id, t.cid, t.conta, b.valor AS v, b.data AS d, t.venc FROM rtit t JOIN rbx b ON b.tid = t.id WHERE t.tem_baixa
    UNION ALL
    SELECT t.id, t.cid, t.conta, COALESCE(t.valor_pago, t.valor), t.data_pagamento, t.venc FROM rtit t WHERE NOT t.tem_baixa
  ),
  plan0 AS (
    SELECT t.id, t.cid, t.nkey, b.valor AS v, b.data AS d, t.venc FROM ptit t JOIN pbx b ON b.tid = t.id WHERE t.tem_baixa
    UNION ALL
    SELECT t.id, t.cid, t.nkey, COALESCE(t.valor_pago, t.valor), t.data_pagamento, t.venc FROM ptit t WHERE NOT t.tem_baixa
  ),
  corte AS (SELECT ch.company_id AS cid, ch.data_corte AS dc FROM erp_empresa_corte_historico ch WHERE ch.company_id = ANY(v_ids)),
  rlan AS (
    SELECT l.id, l.cid, l.conta, l.v, l.d FROM rlan0 l LEFT JOIN corte k ON k.cid = l.cid
    WHERE (k.dc IS NULL OR l.d >= k.dc OR COALESCE(l.venc, l.d) >= k.dc) AND l.d <= p_data
  ),
  plan AS (
    SELECT l.id, l.cid, l.nkey, l.v, l.d FROM plan0 l LEFT JOIN corte k ON k.cid = l.cid
    WHERE (k.dc IS NULL OR l.d >= k.dc OR COALESCE(l.venc, l.d) >= k.dc) AND l.d <= p_data
  ),
  -- por conta, dois buckets: antes do dia (saldo inicial) e no dia (entradas/saídas)
  rec AS (
    SELECT c.id AS conta_id,
           COALESCE(SUM(l.v) FILTER (WHERE l.d < p_data), 0) AS ini,
           COALESCE(SUM(l.v) FILTER (WHERE l.d = p_data), 0) AS dia
    FROM contas c JOIN rlan l ON l.conta = c.id AND l.d >= c.dsi GROUP BY c.id
  ),
  pag AS (
    SELECT c.id AS conta_id,
           COALESCE(SUM(l.v) FILTER (WHERE l.d < p_data), 0) AS ini,
           COALESCE(SUM(l.v) FILTER (WHERE l.d = p_data), 0) AS dia
    FROM contas c
    JOIN nkey_ct k ON k.cid = c.cid AND k.nkey = c.nkey AND k.n = 1
    JOIN plan l ON l.nkey = c.nkey AND l.cid = c.cid AND l.d >= c.dsi GROUP BY c.id
  ),
  tr AS (SELECT * FROM public.fn_saldo_transferencias_contas(v_ids) WHERE data <= p_data),
  te AS (SELECT conta_destino_id AS conta_id,
           COALESCE(SUM(valor) FILTER (WHERE data < p_data),0) AS ini,
           COALESCE(SUM(valor) FILTER (WHERE data = p_data),0) AS dia
         FROM tr WHERE conta_na_entrada GROUP BY 1),
  ts AS (SELECT conta_origem_id AS conta_id,
           COALESCE(SUM(valor) FILTER (WHERE data < p_data),0) AS ini,
           COALESCE(SUM(valor) FILTER (WHERE data = p_data),0) AS dia
         FROM tr WHERE conta_na_saida GROUP BY 1),
  -- "Sem conta" por empresa: lançamentos não atribuídos a uma conta (receber sem conta_bancaria_id; pagar sem nome único)
  sem AS (
    SELECT vid AS cid,
      COALESCE((SELECT SUM(l.v) FILTER (WHERE l.d < p_data) FROM rlan l WHERE l.cid = vid AND l.conta IS NULL),0) AS r_ini,
      COALESCE((SELECT SUM(l.v) FILTER (WHERE l.d = p_data) FROM rlan l WHERE l.cid = vid AND l.conta IS NULL),0) AS r_dia,
      COALESCE((SELECT SUM(l.v) FILTER (WHERE l.d < p_data) FROM plan l WHERE l.cid = vid AND COALESCE((SELECT k.n FROM nkey_ct k WHERE k.cid = vid AND k.nkey = l.nkey),0) <> 1),0) AS p_ini,
      COALESCE((SELECT SUM(l.v) FILTER (WHERE l.d = p_data) FROM plan l WHERE l.cid = vid AND COALESCE((SELECT k.n FROM nkey_ct k WHERE k.cid = vid AND k.nkey = l.nkey),0) <> 1),0) AS p_dia
    FROM unnest(v_ids) AS vid
  ),
  -- linha por conta real
  linha AS (
    SELECT c.cid, c.id AS conta_id, c.nm,
           round(c.si + COALESCE(rec.ini,0) - COALESCE(pag.ini,0) + COALESCE(te.ini,0) - COALESCE(ts.ini,0), 2) AS saldo_inicial,
           round(COALESCE(rec.dia,0), 2) AS entradas,
           round(COALESCE(pag.dia,0), 2) AS saidas,
           round(COALESCE(te.dia,0) - COALESCE(ts.dia,0), 2) AS transf
    FROM contas c
    LEFT JOIN rec ON rec.conta_id = c.id LEFT JOIN pag ON pag.conta_id = c.id
    LEFT JOIN te ON te.conta_id = c.id LEFT JOIN ts ON ts.conta_id = c.id
    UNION ALL
    -- linha "Sem conta" (só aparece quando há lançamento sem conta)
    SELECT s.cid, NULL::uuid, 'Sem conta'::text,
           round(s.r_ini - s.p_ini, 2), round(s.r_dia,2), round(s.p_dia,2), 0::numeric
    FROM sem s WHERE abs(s.r_ini)+abs(s.r_dia)+abs(s.p_ini)+abs(s.p_dia) > 0.005
  ),
  linha_f AS (
    SELECT l.*, round(l.saldo_inicial + l.entradas - l.saidas + l.transf, 2) AS saldo_final FROM linha l
  ),
  emp AS (
    SELECT lf.cid,
      jsonb_agg(jsonb_build_object('conta_id', lf.conta_id, 'nome', lf.nm,
        'saldo_inicial', lf.saldo_inicial, 'entradas', lf.entradas, 'saidas', lf.saidas,
        'transf', lf.transf, 'saldo_final', lf.saldo_final)
        ORDER BY (lf.conta_id IS NULL), lf.nm) AS contas,
      round(SUM(lf.saldo_inicial),2) AS saldo_inicial, round(SUM(lf.entradas),2) AS entradas,
      round(SUM(lf.saidas),2) AS saidas, round(SUM(lf.transf),2) AS transf, round(SUM(lf.saldo_final),2) AS saldo_final
    FROM linha_f lf GROUP BY lf.cid
  ),
  -- Todas as empresas do grupo viram coluna (mesmo sem conta/movimento): parte das empresas, LEFT JOIN emp.
  emp_full AS (
    SELECT co.id AS cid, coalesce(co.nome_fantasia, co.razao_social) AS nome,
           COALESCE(e.contas, '[]'::jsonb) AS contas,
           COALESCE(e.saldo_inicial,0) AS saldo_inicial, COALESCE(e.entradas,0) AS entradas,
           COALESCE(e.saidas,0) AS saidas, COALESCE(e.transf,0) AS transf, COALESCE(e.saldo_final,0) AS saldo_final
    FROM unnest(v_ids) AS vid
    JOIN companies co ON co.id = vid
    LEFT JOIN emp e ON e.cid = vid
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
       'company_id', ef.cid, 'nome', ef.nome, 'contas', ef.contas,
       'saldo_inicial', ef.saldo_inicial, 'entradas', ef.entradas, 'saidas', ef.saidas,
       'transf', ef.transf, 'saldo_final', ef.saldo_final) ORDER BY ef.nome), '[]'::jsonb),
    jsonb_build_object(
      'saldo_inicial', round(COALESCE(SUM(ef.saldo_inicial),0),2), 'entradas', round(COALESCE(SUM(ef.entradas),0),2),
      'saidas', round(COALESCE(SUM(ef.saidas),0),2), 'transf', round(COALESCE(SUM(ef.transf),0),2),
      'saldo_final', round(COALESCE(SUM(ef.saldo_final),0),2))
  INTO v_empresas, v_cons
  FROM emp_full ef;

  -- Bloco "o que vence": títulos em aberto por data de vencimento (hoje / atrasado / próximos 7 dias).
  WITH vr AS (
    SELECT (CASE WHEN er.data_vencimento < p_data THEN 'atrasado'
                 WHEN er.data_vencimento = p_data THEN 'hoje' ELSE 'proximos7' END) AS bucket,
           GREATEST(er.valor - COALESCE(er.valor_pago,0), 0) AS rem
    FROM erp_receber er WHERE er.company_id = ANY(v_ids) AND er.deleted_at IS NULL
      AND er.status NOT IN ('cancelado','recebido','pago')
      AND GREATEST(er.valor - COALESCE(er.valor_pago,0),0) > 0.005
      AND er.data_vencimento <= p_data + 7
  ),
  vp AS (
    SELECT (CASE WHEN ep.data_vencimento < p_data THEN 'atrasado'
                 WHEN ep.data_vencimento = p_data THEN 'hoje' ELSE 'proximos7' END) AS bucket,
           GREATEST(ep.valor - COALESCE(ep.valor_pago,0), 0) AS rem
    FROM erp_pagar ep WHERE ep.company_id = ANY(v_ids) AND ep.deleted_at IS NULL
      AND ep.status NOT IN ('cancelado','pago')
      AND GREATEST(ep.valor - COALESCE(ep.valor_pago,0),0) > 0.005
      AND ep.data_vencimento <= p_data + 7
  )
  SELECT jsonb_build_object(
    'receber', jsonb_build_object(
      'hoje', round(COALESCE((SELECT SUM(rem) FROM vr WHERE bucket='hoje'),0),2),
      'atrasado', round(COALESCE((SELECT SUM(rem) FROM vr WHERE bucket='atrasado'),0),2),
      'proximos7', round(COALESCE((SELECT SUM(rem) FROM vr WHERE bucket='proximos7'),0),2)),
    'pagar', jsonb_build_object(
      'hoje', round(COALESCE((SELECT SUM(rem) FROM vp WHERE bucket='hoje'),0),2),
      'atrasado', round(COALESCE((SELECT SUM(rem) FROM vp WHERE bucket='atrasado'),0),2),
      'proximos7', round(COALESCE((SELECT SUM(rem) FROM vp WHERE bucket='proximos7'),0),2))),
    ((SELECT count(*) FROM vr WHERE bucket='atrasado') + (SELECT count(*) FROM vp WHERE bucket='atrasado'))
  INTO v_vence, v_atrasados;

  -- Formato pt-BR determinístico (padrão literal ','/'.' e translate — independe do lc_numeric do banco).
  v_resumo := 'Entrou R$ ' || translate(to_char((v_cons->>'entradas')::numeric, 'FM999,999,990.00'), '.,', ',.')
    || ', saiu R$ ' || translate(to_char((v_cons->>'saidas')::numeric, 'FM999,999,990.00'), '.,', ',.')
    || ', caixa do grupo R$ ' || translate(to_char((v_cons->>'saldo_final')::numeric, 'FM999,999,990.00'), '.,', ',.')
    || CASE WHEN v_atrasados > 0 THEN ', ' || v_atrasados || ' título(s) atrasado(s).' ELSE ', nenhum título atrasado.' END;

  RETURN jsonb_build_object('ok', true, 'data', p_data, 'empresas', v_empresas, 'consolidado', v_cons,
    'vence', v_vence, 'atrasados_n', v_atrasados, 'resumo', v_resumo);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_caixa_grupo_dia(uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_caixa_grupo_dia(uuid[], date) TO authenticated, service_role;

-- ── Drill-through: os títulos por trás de um número (entradas/saídas do dia, ou o que vence) ─────────────────
CREATE OR REPLACE FUNCTION public.fn_caixa_grupo_titulos(
  p_company_ids uuid[], p_data date, p_bucket text, p_company_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_ids uuid[]; v_out jsonb;
BEGIN
  IF coalesce(current_setting('request.jwt.claims', true), '') = '' OR auth.role() = 'service_role' THEN
    v_ids := p_company_ids;
  ELSE
    SELECT array_agg(x) INTO v_ids FROM unnest(p_company_ids) x WHERE x IN (SELECT get_user_company_ids());
  END IF;
  IF p_company_id IS NOT NULL THEN
    v_ids := ARRAY(SELECT x FROM unnest(v_ids) x WHERE x = p_company_id);
  END IF;
  IF v_ids IS NULL OR array_length(v_ids,1) IS NULL THEN RETURN '[]'::jsonb; END IF;

  IF p_bucket = 'entradas' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', er.id, 'nome', coalesce(er.cliente_nome,'—'),
             'descricao', er.descricao, 'valor', round(b.valor,2), 'data', b.data) ORDER BY b.valor DESC), '[]'::jsonb)
      INTO v_out
      FROM erp_receber_baixa b JOIN erp_receber er ON er.id = b.receber_id
      WHERE b.company_id = ANY(v_ids) AND b.deleted_at IS NULL AND b.data = p_data AND er.deleted_at IS NULL;
  ELSIF p_bucket = 'saidas' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', ep.id, 'nome', coalesce(ep.fornecedor_nome,'—'),
             'descricao', ep.descricao, 'valor', round(b.valor,2), 'data', b.data) ORDER BY b.valor DESC), '[]'::jsonb)
      INTO v_out
      FROM erp_pagar_baixa b JOIN erp_pagar ep ON ep.id = b.pagar_id
      WHERE b.company_id = ANY(v_ids) AND b.deleted_at IS NULL AND b.data = p_data AND ep.deleted_at IS NULL;
  ELSIF p_bucket IN ('receber_hoje','receber_atrasado','receber_proximos7') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', er.id, 'nome', coalesce(er.cliente_nome,'—'),
             'descricao', er.descricao, 'valor', round(GREATEST(er.valor-COALESCE(er.valor_pago,0),0),2),
             'data', er.data_vencimento) ORDER BY er.data_vencimento, er.valor DESC), '[]'::jsonb)
      INTO v_out
      FROM erp_receber er WHERE er.company_id = ANY(v_ids) AND er.deleted_at IS NULL
        AND er.status NOT IN ('cancelado','recebido','pago') AND GREATEST(er.valor-COALESCE(er.valor_pago,0),0) > 0.005
        AND ( (p_bucket='receber_hoje' AND er.data_vencimento = p_data)
           OR (p_bucket='receber_atrasado' AND er.data_vencimento < p_data)
           OR (p_bucket='receber_proximos7' AND er.data_vencimento > p_data AND er.data_vencimento <= p_data+7) );
  ELSIF p_bucket IN ('pagar_hoje','pagar_atrasado','pagar_proximos7') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', ep.id, 'nome', coalesce(ep.fornecedor_nome,'—'),
             'descricao', ep.descricao, 'valor', round(GREATEST(ep.valor-COALESCE(ep.valor_pago,0),0),2),
             'data', ep.data_vencimento) ORDER BY ep.data_vencimento, ep.valor DESC), '[]'::jsonb)
      INTO v_out
      FROM erp_pagar ep WHERE ep.company_id = ANY(v_ids) AND ep.deleted_at IS NULL
        AND ep.status NOT IN ('cancelado','pago') AND GREATEST(ep.valor-COALESCE(ep.valor_pago,0),0) > 0.005
        AND ( (p_bucket='pagar_hoje' AND ep.data_vencimento = p_data)
           OR (p_bucket='pagar_atrasado' AND ep.data_vencimento < p_data)
           OR (p_bucket='pagar_proximos7' AND ep.data_vencimento > p_data AND ep.data_vencimento <= p_data+7) );
  ELSE
    v_out := '[]'::jsonb;
  END IF;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_caixa_grupo_titulos(uuid[], date, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_caixa_grupo_titulos(uuid[], date, text, uuid) TO authenticated, service_role;

-- ── Menu em FINANCEIRO: copia a linha de fluxo_caixa (mesmo grupo/plano), rota nova, aditivo ────────────────
INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, descricao, layer, vertical_specific,
  is_shared, dependencies, subgrupo, surface_in_groups, legacy, diferencial, prioridade, ramos_aplicaveis,
  rbac_isento, rbac_isento_motivo, so_ps)
SELECT 'caixa_grupo', 'Caixa do dia do grupo', grupo, icone, '/dashboard/financeiro/caixa-grupo',
  COALESCE(ordem,50) + 1, ativo,
  'Caixa do dia de todas as empresas do grupo, por empresa e consolidado: saldo inicial, entradas e saídas do dia por conta, e o que vence hoje/atrasado/7 dias. Só leitura.',
  layer, vertical_specific, is_shared, dependencies, subgrupo, surface_in_groups, legacy, diferencial, prioridade,
  ramos_aplicaveis, rbac_isento, rbac_isento_motivo, so_ps
FROM public.module_catalog WHERE id = 'fluxo_caixa'
ON CONFLICT (id) DO NOTHING;

-- Liga o módulo novo a todo plano que já tem o fluxo_caixa
INSERT INTO public.plan_modules (id, plan_id, module_id, is_default_active, minimum_sla, legacy)
SELECT gen_random_uuid(), pm.plan_id, 'caixa_grupo', pm.is_default_active, pm.minimum_sla, pm.legacy
FROM public.plan_modules pm
WHERE pm.module_id = 'fluxo_caixa'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'caixa_grupo');

-- system_screens (RD-96 item 3 + RD-98 p3 origem do dado, senão o gate de origem /dashboard/financeiro% quebra)
INSERT INTO public.system_screens (id, rota, area, titulo, estado_real, prioridade_monitoramento, modulo,
  auditavel_robo, rpcs_chamadas, views_consumidas, criado_em, atualizado_em)
SELECT gen_random_uuid(), '/dashboard/financeiro/caixa-grupo', 'financeiro', 'Caixa do dia do grupo', 'pronto', 'media',
  'gestao_empresarial', true,
  ARRAY['fn_caixa_grupo_dia','fn_caixa_grupo_titulos']::text[],
  ARRAY['erp_banco_contas','erp_receber','erp_pagar','erp_receber_baixa','erp_pagar_baixa','erp_transferencia','companies']::text[],
  now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens WHERE rota = '/dashboard/financeiro/caixa-grupo');

-- ── RD-95: ajuda "?" de todos os campos/indicadores/ações da tela ──────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/financeiro/caixa-grupo', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('financeiro.caixa_grupo.data', 'Filtros', 'Data',
  'Escolha o dia que quer ver. O padrão é hoje.',
  'Define o retrato do caixa: saldo no fim do dia anterior, o que entrou e saiu nesse dia e o saldo no fim dele.',
  'Deixe em hoje para fechar o dia; volte a data para conferir um dia passado.',
  'Achar que muda de mês: aqui é um dia só, não um período.', 1),
 ('financeiro.caixa_grupo.empresa', 'Colunas', 'Empresa / CNPJ',
  'Cada empresa do grupo vira uma coluna; a última é o consolidado do grupo.',
  'Ver o caixa de cada CNPJ lado a lado e o total do grupo numa tela só.',
  'Prigol e Proplay aparecem separadas e somadas no consolidado.',
  'Esperar empresas que você não acessa: a tela só mostra as suas.', 2),
 ('financeiro.caixa_grupo.saldo_inicial', 'Indicadores', 'Saldo inicial',
  'Não se preenche: é o saldo das contas no fim do dia anterior.',
  'Ponto de partida do dia — de quanto o caixa começou.',
  'Se ontem fechou em R$ 10.000, o saldo inicial de hoje é R$ 10.000.',
  'Confundir com o saldo inicial cadastrado da conta: aqui é o do dia anterior.', 3),
 ('financeiro.caixa_grupo.entradas', 'Indicadores', 'Entradas do dia',
  'Não se preenche: soma dos recebimentos baixados nesse dia.',
  'Quanto dinheiro entrou no caixa no dia.',
  'Dois clientes pagaram hoje R$ 1.500 → entradas do dia R$ 1.500.',
  'Esperar o previsto: aqui é só o que foi efetivamente recebido (baixado).', 4),
 ('financeiro.caixa_grupo.saidas', 'Indicadores', 'Saídas do dia',
  'Não se preenche: soma dos pagamentos baixados nesse dia.',
  'Quanto dinheiro saiu do caixa no dia.',
  'Pagou o aluguel hoje R$ 3.000 → saídas do dia R$ 3.000.',
  'Esperar contas a vencer: aqui é só o que foi efetivamente pago (baixado).', 5),
 ('financeiro.caixa_grupo.saldo_final', 'Indicadores', 'Saldo final',
  'Não se preenche: saldo inicial + entradas − saídas (+ transferências entre contas da empresa).',
  'Com quanto o caixa terminou o dia, por conta, por empresa e no consolidado.',
  'R$ 10.000 + R$ 1.500 − R$ 3.000 = R$ 8.500.',
  'Não bater com o banco: o botão de cada número mostra os títulos para conferir.', 6),
 ('financeiro.caixa_grupo.conta', 'Colunas', 'Por conta',
  'Não se preenche: abre o saldo de cada conta bancária da empresa.',
  'Saber em qual banco está o dinheiro de cada empresa.',
  'Bradesco R$ 8.000 e Sicredi R$ 500 na mesma empresa.',
  'Transferência entre contas da MESMA empresa muda a conta, mas não é entrada nem saída do caixa.', 7),
 ('financeiro.caixa_grupo.vence', 'Indicadores', 'O que vence',
  'Não se preenche: a receber e a pagar em aberto, por vencimento (hoje, atrasado e próximos 7 dias).',
  'Antecipar o caixa: o que ainda vai entrar e sair nos próximos dias.',
  '3 títulos atrasados a receber e R$ 2.000 a pagar nos próximos 7 dias.',
  'Confundir com entradas/saídas do dia: aqui é o que ainda NÃO foi pago/recebido.', 8),
 ('financeiro.caixa_grupo.titulos', 'Ações', 'Ver títulos',
  'Clique em qualquer número para ver os títulos que o formam.',
  'Conferir de onde vem cada valor, título a título.',
  'Clicar nas entradas do dia lista cada recebimento baixado.',
  'Procurar um botão separado: o próprio número é clicável.', 9),
 ('financeiro.caixa_grupo.resumo', 'Indicadores', 'Resumo do dia',
  'Não se preenche: a frase no topo resume entrou, saiu, caixa do grupo e atrasados.',
  'Ler o dia do grupo em uma frase, sem somar nada na cabeça.',
  '"Entrou R$ X, saiu R$ Y, caixa do grupo R$ Z, 3 títulos atrasados."',
  'Achar que é por empresa: o resumo é do grupo consolidado.', 10)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
