-- =============================================================================
-- Composição do saldo: linha "Sem conta" só a partir do início do controle (jordana-code · chamado #3866, Troian)
--
-- Antes: fn_saldo_gerencial_contas aplicava a data do saldo inicial só às contas com banco; o bloco "Sem conta" somava
-- TUDO o que foi liquidado sem conta bancária, sem corte de data. Com o histórico importado da Troian (desde 22/08/2024)
-- a linha mostrava 8.241 títulos (R$ 2,68 mi recebidos / R$ 2,73 mi pagos) e o card "títulos baixados sem conta"
-- apontava como pendência o que é histórico.
--
-- Agora: o início do controle da empresa é a menor data_saldo_inicial das contas ativas que somam no saldo (Troian:
-- BRADESCO PJ 01/10/2026). O liquidado ANTES dessa data fica como histórico: não entra na linha "Sem conta" nem no card;
-- continua nas consultas, relatórios e DRE (nada aqui toca o dado importado). A linha "Sem conta" passa a devolver a
-- data de corte em data_saldo_inicial (era NULL) para a tela explicar o corte.
-- Prova (20/10, cópia em pg_temp + ROLLBACK): Troian "Sem conta" 8.241 → 172 títulos (87 recebidas R$ 48.653,92 e
-- 85 pagas R$ 127.717,83 desde 01/10); saldo das contas igual; Gean: todas as linhas idênticas (diferença zero).
-- Empresa com conta ativa sem data de saldo inicial: sem corte (como antes).
-- Mesmo retorno, mesma guarda, mesmos grants (só service_role).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_saldo_gerencial_contas(p_company_ids uuid[])
 RETURNS TABLE(company_id uuid, conta_id uuid, nome text, tipo_conta text, soma_no_saldo boolean, saldo_inicial numeric, data_saldo_inicial date, recebido numeric, pago numeric, saldo_gerencial numeric, saldo_extrato numeric, diferenca numeric, n_titulos integer, transf_entrada numeric, transf_saida numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ids uuid[];
BEGIN
  -- guarda de empresa (igual à anterior): sem JWT = chamada interna; service_role passa; logado é filtrado.
  IF coalesce(current_setting('request.jwt.claims', true), '') = '' OR auth.role() = 'service_role' THEN
    v_ids := p_company_ids;
  ELSE
    SELECT array_agg(x) INTO v_ids FROM unnest(p_company_ids) x WHERE x IN (SELECT get_user_company_ids());
  END IF;
  IF v_ids IS NULL OR array_length(v_ids,1) IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH contas AS (
    SELECT bc.id, bc.company_id AS cid, bc.nome::text AS nm, lower(btrim(bc.nome)) AS nkey,
           bc.tipo_conta::text AS tipo, COALESCE(bc.soma_no_saldo,true) AS soma,
           COALESCE(bc.saldo_inicial,0) AS si, COALESCE(bc.data_saldo_inicial,'1900-01-01'::date) AS dsi,
           bc.saldo_extrato AS se
    FROM erp_banco_contas bc
    WHERE bc.company_id = ANY(v_ids) AND bc.ativo = true
  ),
  nkey_ct AS (SELECT c.cid, c.nkey, count(*) AS n FROM contas c GROUP BY 1,2),
  -- baixas ativas das empresas pedidas (uma linha por pagamento: valor e data de cada um)
  rbx AS (SELECT b.receber_id AS tid, b.valor, b.data FROM erp_receber_baixa b WHERE b.company_id = ANY(v_ids) AND b.deleted_at IS NULL),
  pbx AS (SELECT b.pagar_id AS tid, b.valor, b.data FROM erp_pagar_baixa b WHERE b.company_id = ANY(v_ids) AND b.deleted_at IS NULL),
  rtem AS (SELECT DISTINCT tid FROM rbx),
  ptem AS (SELECT DISTINCT tid FROM pbx),
  -- títulos que entram no saldo: com baixa (recebido/pago/parcial) ou quitado legado sem baixa
  rtit AS (
    SELECT er.id, er.company_id AS cid, er.conta_bancaria_id AS conta, er.valor_pago, er.valor, er.data_pagamento,
           (rt.tid IS NOT NULL) AS tem_baixa
    FROM erp_receber er LEFT JOIN rtem rt ON rt.tid = er.id
    WHERE er.company_id = ANY(v_ids) AND er.deleted_at IS NULL
      AND ( (rt.tid IS NOT NULL AND er.status IN ('recebido','pago','parcial'))
         OR (rt.tid IS NULL AND er.status IN ('recebido','pago') AND er.data_pagamento IS NOT NULL) )
  ),
  ptit AS (
    SELECT ep.id, ep.company_id AS cid, lower(btrim(ep.conta_bancaria)) AS nkey, ep.valor_pago, ep.valor, ep.data_pagamento,
           (pt.tid IS NOT NULL) AS tem_baixa
    FROM erp_pagar ep LEFT JOIN ptem pt ON pt.tid = ep.id
    WHERE ep.company_id = ANY(v_ids) AND ep.deleted_at IS NULL
      AND ( (pt.tid IS NOT NULL AND ep.status IN ('pago','parcial'))
         OR (pt.tid IS NULL AND ep.status = 'pago' AND ep.data_pagamento IS NOT NULL) )
  ),
  -- lançamentos (data, valor) de cada título: as baixas, ou o valor_pago do legado
  rlan AS (
    SELECT t.id, t.cid, t.conta, b.valor AS v, b.data AS d FROM rtit t JOIN rbx b ON b.tid = t.id WHERE t.tem_baixa
    UNION ALL
    SELECT t.id, t.cid, t.conta, COALESCE(t.valor_pago, t.valor), t.data_pagamento FROM rtit t WHERE NOT t.tem_baixa
  ),
  plan AS (
    SELECT t.id, t.cid, t.nkey, b.valor AS v, b.data AS d FROM ptit t JOIN pbx b ON b.tid = t.id WHERE t.tem_baixa
    UNION ALL
    SELECT t.id, t.cid, t.nkey, COALESCE(t.valor_pago, t.valor), t.data_pagamento FROM ptit t WHERE NOT t.tem_baixa
  ),
  rec AS (
    SELECT c.id AS conta_id, SUM(l.v) AS v, count(DISTINCT l.id)::int AS n
    FROM contas c JOIN rlan l ON l.conta = c.id AND l.d >= c.dsi
    GROUP BY c.id
  ),
  pag AS (
    SELECT c.id AS conta_id, SUM(l.v) AS v, count(DISTINCT l.id)::int AS n
    FROM contas c
    JOIN nkey_ct k ON k.cid = c.cid AND k.nkey = c.nkey AND k.n = 1
    JOIN plan l ON l.nkey = c.nkey AND l.cid = c.cid AND l.d >= c.dsi
    GROUP BY c.id
  ),
  tr AS (SELECT * FROM public.fn_saldo_transferencias_contas(v_ids)),
  te AS (SELECT tr.conta_destino_id AS conta_id, SUM(tr.valor) AS v FROM tr WHERE tr.conta_na_entrada GROUP BY 1),
  ts AS (SELECT tr.conta_origem_id AS conta_id, SUM(tr.valor) AS v FROM tr WHERE tr.conta_na_saida GROUP BY 1),
  -- #3866: início do controle da empresa = menor data de saldo inicial das contas ativas que somam no saldo (a mesma
  -- data_efetiva_calculo_atual da composição; conta sem data = sem corte, então empresa sem data configurada não muda).
  -- Liquidado antes disso é histórico importado: fica fora da linha "Sem conta" (continua nas consultas e na DRE).
  corte AS (SELECT vid AS cid, (SELECT MIN(c.dsi) FROM contas c WHERE c.cid = vid AND c.soma) AS dc FROM unnest(v_ids) AS vid),
  sem AS (
    SELECT ct.cid, ct.dc,
      COALESCE((SELECT SUM(l.v) FROM rlan l WHERE l.cid = ct.cid AND l.conta IS NULL AND l.d >= COALESCE(ct.dc,'1900-01-01'::date)),0) AS rec_v,
      COALESCE((SELECT count(DISTINCT l.id) FROM rlan l WHERE l.cid = ct.cid AND l.conta IS NULL AND l.d >= COALESCE(ct.dc,'1900-01-01'::date)),0)::int AS rec_n,
      COALESCE((SELECT SUM(l.v) FROM plan l WHERE l.cid = ct.cid AND l.d >= COALESCE(ct.dc,'1900-01-01'::date) AND COALESCE((SELECT k.n FROM nkey_ct k WHERE k.cid = ct.cid AND k.nkey = l.nkey),0) <> 1),0) AS pag_v,
      COALESCE((SELECT count(DISTINCT l.id) FROM plan l WHERE l.cid = ct.cid AND l.d >= COALESCE(ct.dc,'1900-01-01'::date) AND COALESCE((SELECT k.n FROM nkey_ct k WHERE k.cid = ct.cid AND k.nkey = l.nkey),0) <> 1),0)::int AS pag_n
    FROM corte ct
  ),
  calc AS (
    SELECT c.*, COALESCE(rec.v,0) AS rv, COALESCE(pag.v,0) AS pv, COALESCE(te.v,0) AS tev, COALESCE(ts.v,0) AS tsv,
           COALESCE(rec.n,0) + COALESCE(pag.n,0) AS nt
    FROM contas c
    LEFT JOIN rec ON rec.conta_id = c.id LEFT JOIN pag ON pag.conta_id = c.id
    LEFT JOIN te ON te.conta_id = c.id LEFT JOIN ts ON ts.conta_id = c.id
  )
  SELECT k.cid, k.id, k.nm, k.tipo, k.soma, round(k.si,2), k.dsi, round(k.rv,2), round(k.pv,2),
         round(k.si + k.rv - k.pv + k.tev - k.tsv, 2), k.se,
         CASE WHEN k.se IS NOT NULL THEN round((k.si + k.rv - k.pv + k.tev - k.tsv) - k.se, 2) END,
         k.nt, round(k.tev,2), round(k.tsv,2)
  FROM calc k
  UNION ALL
  SELECT s.cid, NULL::uuid, 'Sem conta'::text, NULL::text, false, 0::numeric, s.dc,
         round(s.rec_v,2), round(s.pag_v,2), round(s.rec_v - s.pag_v,2), NULL::numeric, NULL::numeric,
         (s.rec_n + s.pag_n), 0::numeric, 0::numeric
  FROM sem s WHERE (s.rec_n + s.pag_n) > 0
  ORDER BY 1, 5 DESC, 3;
END $function$;

REVOKE ALL ON FUNCTION public.fn_saldo_gerencial_contas(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_saldo_gerencial_contas(uuid[]) TO service_role;

-- "?" (RD-95) da linha "Sem conta" na composição do saldo
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Financeiro', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/gestao-empresarial', 'financeiro', 'publicado'
FROM (VALUES
  ('ge.saldo.sem_conta', 'Liquidado sem conta',
   'Nada a preencher: são os recebimentos e pagamentos baixados SEM conta bancária a partir do início do controle (a data do saldo inicial mais antiga das suas contas).',
   'Mostra o que ficou fora do saldo de todas as contas porque a baixa não disse de qual conta saiu ou entrou o dinheiro. Abra a lista, informe a conta na baixa e o valor passa a contar no saldo da conta certa.',
   'Controle desde 01/10: 87 recebidas e 85 pagas de outubro sem conta. O histórico importado antes de 01/10 não aparece aqui (continua nos relatórios e na DRE).',
   'Esperar que o histórico anterior ao saldo inicial apareça aqui: ele já está dentro do saldo inicial informado e não é pendência.', 1)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
