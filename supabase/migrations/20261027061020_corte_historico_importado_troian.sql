-- =============================================================================
-- Corte do histórico importado POR EMPRESA (jordana-code · chamado #3866, ajuste da Jordana 26/10 — substitui a PR #2924)
--
-- Troian Corretora de Seguros: todo o histórico foi importado (desde 08/2024) só para consulta. Hoje o bloco "Sem conta"
-- de fn_saldo_gerencial_contas soma todo o liquidado sem conta bancária, sem corte: 8 mil títulos antigos aparecem na
-- composição do saldo e no card "títulos baixados sem conta".
--
-- Regra (Jordana, 26/10), restrita à empresa configurada — nenhuma outra empresa muda:
--   * nova tabela erp_empresa_corte_historico (company_id, data_corte). Só a Troian recebe linha: 01/10/2026;
--   * na empresa com corte, lançamento (baixa, ou valor_pago do legado) de título com VENCIMENTO antes do corte e
--     pago antes do corte fica só para consulta: fora do saldo das contas e fora do "Sem conta";
--   * exceção: pagamento com data a partir do corte conta no saldo da conta onde foi pago, mesmo com vencimento antigo;
--   * empresa sem linha na tabela: LEFT JOIN sem corte = cálculo idêntico ao de antes (prova: Gean/Prigol diferença zero).
-- fn_saldos_empresa, fn_saldo_composicao e fn_saldo_bancos_dinamico leem desta função e herdam o corte.
-- Nenhum título é alterado ou apagado: o histórico segue nas listagens, relatórios e DRE.
-- Mesmo retorno, mesma guarda, mesmos grants (só service_role). Definição viva conferida (prosrc = 20261016235020).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.erp_empresa_corte_historico (
  company_id     uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  data_corte     date NOT NULL,
  motivo         text,
  atualizado_por text,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.erp_empresa_corte_historico IS
  'Data de corte do histórico importado por empresa: título vencido e pago antes dela fica só para consulta (fora do saldo e das pendências sem conta). Chamado #3866.';

ALTER TABLE public.erp_empresa_corte_historico ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_empresa_corte_historico FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.erp_empresa_corte_historico TO authenticated;
DROP POLICY IF EXISTS erp_empresa_corte_historico_ler ON public.erp_empresa_corte_historico;
CREATE POLICY erp_empresa_corte_historico_ler ON public.erp_empresa_corte_historico FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
-- Escrita: nenhuma policy → só por migration / service_role.

-- Troian Corretora de Seguros: corte em 01/10/2026 (decisão da Jordana, 26/10). Só grava se a empresa existir.
INSERT INTO public.erp_empresa_corte_historico (company_id, data_corte, motivo, atualizado_por)
SELECT c.id, DATE '2026-10-01', 'Histórico importado para consulta — chamado #3866 (Jordana, 26/10)', 'jordana-code'
FROM public.companies c WHERE c.id = 'd577602d-b21a-4d97-ae59-401777383c23'
ON CONFLICT (company_id) DO NOTHING;

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
  -- lançamentos (data, valor) de cada título: as baixas, ou o valor_pago do legado
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
  -- corte do histórico importado (só empresa configurada em erp_empresa_corte_historico; as demais não mudam):
  -- lançamento de título vencido antes do corte e pago antes do corte = só consulta (fora do saldo e do "Sem conta");
  -- pagamento a partir do corte conta, mesmo de título vencido antes.
  corte AS (SELECT ch.company_id AS cid, ch.data_corte AS dc FROM erp_empresa_corte_historico ch WHERE ch.company_id = ANY(v_ids)),
  rlan AS (
    SELECT l.id, l.cid, l.conta, l.v, l.d FROM rlan0 l LEFT JOIN corte k ON k.cid = l.cid
    WHERE k.dc IS NULL OR l.d >= k.dc OR COALESCE(l.venc, l.d) >= k.dc
  ),
  plan AS (
    SELECT l.id, l.cid, l.nkey, l.v, l.d FROM plan0 l LEFT JOIN corte k ON k.cid = l.cid
    WHERE k.dc IS NULL OR l.d >= k.dc OR COALESCE(l.venc, l.d) >= k.dc
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
  sem AS (
    SELECT vid AS cid,
      COALESCE((SELECT SUM(l.v) FROM rlan l WHERE l.cid = vid AND l.conta IS NULL),0) AS rec_v,
      COALESCE((SELECT count(DISTINCT l.id) FROM rlan l WHERE l.cid = vid AND l.conta IS NULL),0)::int AS rec_n,
      COALESCE((SELECT SUM(l.v) FROM plan l WHERE l.cid = vid AND COALESCE((SELECT k.n FROM nkey_ct k WHERE k.cid = vid AND k.nkey = l.nkey),0) <> 1),0) AS pag_v,
      COALESCE((SELECT count(DISTINCT l.id) FROM plan l WHERE l.cid = vid AND COALESCE((SELECT k.n FROM nkey_ct k WHERE k.cid = vid AND k.nkey = l.nkey),0) <> 1),0)::int AS pag_n
    FROM unnest(v_ids) AS vid
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
  SELECT s.cid, NULL::uuid, 'Sem conta'::text, NULL::text, false, 0::numeric, NULL::date,
         round(s.rec_v,2), round(s.pag_v,2), round(s.rec_v - s.pag_v,2), NULL::numeric, NULL::numeric,
         (s.rec_n + s.pag_n), 0::numeric, 0::numeric
  FROM sem s WHERE (s.rec_n + s.pag_n) > 0
  ORDER BY 1, 5 DESC, 3;
END $function$;

-- mesmos grants de antes: só service_role (os logados chegam por fn_saldo_composicao / fn_saldos_empresa)
REVOKE ALL ON FUNCTION public.fn_saldo_gerencial_contas(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_saldo_gerencial_contas(uuid[]) TO service_role;
