-- EMERGÊNCIA (P2 — Eng. Chefe 12/11): Caixa do dia do grupo somava CONTA DE CONTROLE no caixa e não mostrava a
-- diferença com o banco. Três consertos, todos ADITIVOS (CREATE OR REPLACE da mesma assinatura, sem DROP/UPDATE):
--  1) Respeitar erp_banco_contas.soma_no_saldo: contas com soma_no_saldo=false (tipo "controle": PERMUTA,
--     ADIANTAMENTO COMISSÕES, aplicações marcadas como fora do caixa) NÃO entram no saldo da empresa nem no
--     consolidado. Elas voltam no JSON com a flag soma_no_saldo=false para a tela mostrá-las num bloco à parte
--     "Contas de controle (não somam no caixa)".
--  2) Devolver, por conta, o SALDO DO BANCO (saldo_extrato + saldo_extrato_em + saldo_extrato_origem) para a tela
--     mostrar ao lado do saldo do sistema e a diferença (vermelho quando ≠ 0; aviso se o extrato está velho).
--  3) Contar os lançamentos SEM CONTA por empresa (sem_conta_n) e abrir o drill 'sem_conta' para listá-los
--     ("N lançamentos sem conta — atribuir").
-- Prova RD-38: com todas as contas somando (soma_no_saldo=true) o resultado é idêntico ao anterior; o que muda é só
-- a exclusão das contas de controle do total. A linkage (receber por conta_bancaria_id; pagar por nome único;
-- corte histórico; transferências) é a MESMA de antes — nada foi tocado nela.

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
           COALESCE(bc.saldo_inicial,0) AS si, COALESCE(bc.data_saldo_inicial,'1900-01-01'::date) AS dsi,
           COALESCE(bc.soma_no_saldo, true) AS sns,
           bc.saldo_extrato AS sx, bc.saldo_extrato_em AS sxe, bc.saldo_extrato_origem AS sxo
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
  -- quantos títulos (distintos) estão sem conta por empresa — alimenta o aviso "N lançamentos sem conta — atribuir"
  sem_cnt AS (
    SELECT vid AS cid,
      COALESCE((SELECT count(DISTINCT l.id) FROM rlan l WHERE l.cid = vid AND l.conta IS NULL),0)
      + COALESCE((SELECT count(DISTINCT l.id) FROM plan l WHERE l.cid = vid
                    AND COALESCE((SELECT k.n FROM nkey_ct k WHERE k.cid = vid AND k.nkey = l.nkey),0) <> 1),0) AS n
    FROM unnest(v_ids) AS vid
  ),
  -- linha por conta real (+ flag soma_no_saldo e saldo do banco por conta)
  linha AS (
    SELECT c.cid, c.id AS conta_id, c.nm, c.sns, c.sx, c.sxe, c.sxo,
           round(c.si + COALESCE(rec.ini,0) - COALESCE(pag.ini,0) + COALESCE(te.ini,0) - COALESCE(ts.ini,0), 2) AS saldo_inicial,
           round(COALESCE(rec.dia,0), 2) AS entradas,
           round(COALESCE(pag.dia,0), 2) AS saidas,
           round(COALESCE(te.dia,0) - COALESCE(ts.dia,0), 2) AS transf
    FROM contas c
    LEFT JOIN rec ON rec.conta_id = c.id LEFT JOIN pag ON pag.conta_id = c.id
    LEFT JOIN te ON te.conta_id = c.id LEFT JOIN ts ON ts.conta_id = c.id
    UNION ALL
    -- linha "Sem conta" (só aparece quando há lançamento sem conta) — é dinheiro real, soma no caixa
    SELECT s.cid, NULL::uuid, 'Sem conta'::text, true AS sns, NULL::numeric AS sx, NULL::timestamptz AS sxe, NULL::text AS sxo,
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
        'transf', lf.transf, 'saldo_final', lf.saldo_final,
        'soma_no_saldo', lf.sns, 'saldo_extrato', lf.sx, 'saldo_extrato_em', lf.sxe, 'saldo_extrato_origem', lf.sxo)
        ORDER BY (NOT lf.sns), (lf.conta_id IS NULL), lf.nm) AS contas,
      -- totais da empresa somam SÓ as contas que contam no caixa (soma_no_saldo=true, incluindo "Sem conta")
      round(SUM(lf.saldo_inicial) FILTER (WHERE lf.sns),2) AS saldo_inicial, round(SUM(lf.entradas) FILTER (WHERE lf.sns),2) AS entradas,
      round(SUM(lf.saidas) FILTER (WHERE lf.sns),2) AS saidas, round(SUM(lf.transf) FILTER (WHERE lf.sns),2) AS transf,
      round(SUM(lf.saldo_final) FILTER (WHERE lf.sns),2) AS saldo_final
    FROM linha_f lf GROUP BY lf.cid
  ),
  -- Todas as empresas do grupo viram coluna (mesmo sem conta/movimento): parte das empresas, LEFT JOIN emp.
  emp_full AS (
    SELECT co.id AS cid, coalesce(co.nome_fantasia, co.razao_social) AS nome,
           COALESCE(e.contas, '[]'::jsonb) AS contas,
           COALESCE(e.saldo_inicial,0) AS saldo_inicial, COALESCE(e.entradas,0) AS entradas,
           COALESCE(e.saidas,0) AS saidas, COALESCE(e.transf,0) AS transf, COALESCE(e.saldo_final,0) AS saldo_final,
           COALESCE(sc.n,0) AS sem_conta_n
    FROM unnest(v_ids) AS vid
    JOIN companies co ON co.id = vid
    LEFT JOIN emp e ON e.cid = vid
    LEFT JOIN sem_cnt sc ON sc.cid = vid
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
       'company_id', ef.cid, 'nome', ef.nome, 'contas', ef.contas,
       'saldo_inicial', ef.saldo_inicial, 'entradas', ef.entradas, 'saidas', ef.saidas,
       'transf', ef.transf, 'saldo_final', ef.saldo_final, 'sem_conta_n', ef.sem_conta_n) ORDER BY ef.nome), '[]'::jsonb),
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

-- ── Drill-through: + bucket 'sem_conta' (os títulos sem conta de uma empresa, para "atribuir") ───────────────
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
  ELSIF p_bucket = 'sem_conta' THEN
    -- Títulos sem conta atribuída (mesma linkage da fn_caixa_grupo_dia), acumulados até p_data (após corte).
    WITH contas AS (
      SELECT bc.company_id AS cid, lower(btrim(bc.nome)) AS nkey
      FROM erp_banco_contas bc WHERE bc.company_id = ANY(v_ids) AND bc.ativo = true
    ),
    nkey_ct AS (SELECT c.cid, c.nkey, count(*) AS n FROM contas c GROUP BY 1,2),
    rbx AS (SELECT b.receber_id AS tid, b.valor, b.data FROM erp_receber_baixa b WHERE b.company_id = ANY(v_ids) AND b.deleted_at IS NULL),
    pbx AS (SELECT b.pagar_id AS tid, b.valor, b.data FROM erp_pagar_baixa b WHERE b.company_id = ANY(v_ids) AND b.deleted_at IS NULL),
    rtem AS (SELECT DISTINCT tid FROM rbx),
    ptem AS (SELECT DISTINCT tid FROM pbx),
    rtit AS (
      SELECT er.id, er.company_id AS cid, er.conta_bancaria_id AS conta, coalesce(er.cliente_nome,'—') AS nome, er.descricao,
             er.valor_pago, er.valor, er.data_pagamento, er.data_vencimento AS venc, (rt.tid IS NOT NULL) AS tem_baixa
      FROM erp_receber er LEFT JOIN rtem rt ON rt.tid = er.id
      WHERE er.company_id = ANY(v_ids) AND er.deleted_at IS NULL
        AND ( (rt.tid IS NOT NULL AND er.status IN ('recebido','pago','parcial'))
           OR (rt.tid IS NULL AND er.status IN ('recebido','pago') AND er.data_pagamento IS NOT NULL) )
    ),
    ptit AS (
      SELECT ep.id, ep.company_id AS cid, lower(btrim(ep.conta_bancaria)) AS nkey, coalesce(ep.fornecedor_nome,'—') AS nome, ep.descricao,
             ep.valor_pago, ep.valor, ep.data_pagamento, ep.data_vencimento AS venc, (pt.tid IS NOT NULL) AS tem_baixa
      FROM erp_pagar ep LEFT JOIN ptem pt ON pt.tid = ep.id
      WHERE ep.company_id = ANY(v_ids) AND ep.deleted_at IS NULL
        AND ( (pt.tid IS NOT NULL AND ep.status IN ('pago','parcial'))
           OR (pt.tid IS NULL AND ep.status = 'pago' AND ep.data_pagamento IS NOT NULL) )
    ),
    rlan0 AS (
      SELECT t.id, t.cid, t.conta, t.nome, t.descricao, b.valor AS v, b.data AS d, t.venc FROM rtit t JOIN rbx b ON b.tid = t.id WHERE t.tem_baixa
      UNION ALL
      SELECT t.id, t.cid, t.conta, t.nome, t.descricao, COALESCE(t.valor_pago, t.valor), t.data_pagamento, t.venc FROM rtit t WHERE NOT t.tem_baixa
    ),
    plan0 AS (
      SELECT t.id, t.cid, t.nkey, t.nome, t.descricao, b.valor AS v, b.data AS d, t.venc FROM ptit t JOIN pbx b ON b.tid = t.id WHERE t.tem_baixa
      UNION ALL
      SELECT t.id, t.cid, t.nkey, t.nome, t.descricao, COALESCE(t.valor_pago, t.valor), t.data_pagamento, t.venc FROM ptit t WHERE NOT t.tem_baixa
    ),
    corte AS (SELECT ch.company_id AS cid, ch.data_corte AS dc FROM erp_empresa_corte_historico ch WHERE ch.company_id = ANY(v_ids)),
    rlan AS (
      SELECT l.id, l.cid, l.conta, l.nome, l.descricao, l.v, l.d FROM rlan0 l LEFT JOIN corte k ON k.cid = l.cid
      WHERE (k.dc IS NULL OR l.d >= k.dc OR COALESCE(l.venc, l.d) >= k.dc) AND l.d <= p_data
    ),
    plan AS (
      SELECT l.id, l.cid, l.nkey, l.nome, l.descricao, l.v, l.d FROM plan0 l LEFT JOIN corte k ON k.cid = l.cid
      WHERE (k.dc IS NULL OR l.d >= k.dc OR COALESCE(l.venc, l.d) >= k.dc) AND l.d <= p_data
    ),
    itens AS (
      SELECT l.id, l.nome, l.descricao, round(SUM(l.v),2) AS valor, max(l.d) AS data
      FROM rlan l WHERE l.conta IS NULL GROUP BY l.id, l.nome, l.descricao
      UNION ALL
      SELECT l.id, l.nome, l.descricao, round(SUM(l.v),2) AS valor, max(l.d) AS data
      FROM plan l WHERE COALESCE((SELECT k.n FROM nkey_ct k WHERE k.cid = l.cid AND k.nkey = l.nkey),0) <> 1
      GROUP BY l.id, l.nome, l.descricao
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'nome', i.nome, 'descricao', i.descricao,
             'valor', i.valor, 'data', i.data) ORDER BY i.valor DESC), '[]'::jsonb)
      INTO v_out FROM itens i;
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

-- ── RD-95: ajuda "?" dos indicadores NOVOS da tela (banco/extrato, diferença, contas de controle, sem conta) ──
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/financeiro/caixa-grupo', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('financeiro.caixa_grupo.saldo_banco', 'Indicadores', 'Saldo do banco (extrato)',
  'Não se preenche: é o saldo que veio do extrato bancário importado (arquivo OFX ou conexão com o banco) da conta, com a data dele.',
  'Comparar o que o sistema calculou com o que o banco diz de verdade, para fechar a conta.',
  'Extrato de 11/11 trouxe R$ 3.990,65 na conta corrente.',
  'Achar que é automático: o extrato só atualiza quando você importa. Data antiga = importe de novo.', 11),
 ('financeiro.caixa_grupo.diferenca', 'Indicadores', 'Diferença (sistema − banco)',
  'Não se preenche: é o saldo do sistema menos o saldo do extrato do banco.',
  'Mostrar na hora se o caixa do sistema bate com o banco. Em vermelho quando é diferente de zero.',
  'Sistema R$ 16.019,12 e banco R$ 3.990,65 → diferença R$ 12.028,47 (falta conferir lançamentos).',
  'Ignorar a diferença: ela aponta lançamento faltando, duplicado ou conta trocada.', 12),
 ('financeiro.caixa_grupo.contas_controle', 'Indicadores', 'Contas de controle (não somam no caixa)',
  'Não se preenche: contas marcadas como "não somam no saldo" (permuta, adiantamentos, aplicações de controle).',
  'Acompanhar essas contas sem poluir o caixa — elas ficam num bloco à parte, fora do total do grupo.',
  'PERMUTA e ADIANTAMENTO COMISSÕES aparecem aqui, não no caixa real da empresa.',
  'Somar essas contas no caixa: elas não são dinheiro disponível; por isso ficam separadas.', 13),
 ('financeiro.caixa_grupo.sem_conta', 'Ações', 'Lançamentos sem conta',
  'Clique no aviso para ver os títulos que foram baixados sem uma conta bancária atribuída.',
  'Encontrar e atribuir a conta certa: sem conta, o dinheiro entra no caixa mas não aparece em nenhum banco.',
  '"3 lançamentos sem conta — atribuir" abre a lista para você corrigir.',
  'Deixar sem conta: o saldo do grupo fica certo, mas não dá para conferir com o extrato de cada banco.', 14)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
