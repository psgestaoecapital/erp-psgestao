-- =============================================================================
-- Saldo gerencial POR CONTA (regra contábil da Jordana · contexto b49db9cc)
-- RDs 26/38/65/41/34 V5
--
-- Regra: saldo gerencial de UMA conta = saldo_inicial
--   + Σ erp_receber pagos NESSA conta (conta_bancaria_id = conta) com data_pagamento >= data_saldo_inicial DA CONTA
--   − Σ erp_pagar  pagos NESSA conta (nome casa) com data_pagamento >= data_saldo_inicial DA CONTA
--   sempre com deleted_at IS NULL. Título baixado em outra conta é da outra conta.
--   Total da empresa = Σ das contas com soma_no_saldo = true.
--
-- Antes (errado): fn_saldo_bancos_dinamico somava TODOS os receber − TODOS os pagar da empresa desde a
-- MENOR data de saldo inicial, sem olhar a conta do título nem deleted_at, e ainda subtraía "janela_dupla".
-- Ex.: PDOIS mostrava 4.359,23; correto −21.668,87 (a conta PERMUTA soma_no_saldo=false trazia +26.029,00).
--
-- RD-65: um cálculo só. fn_saldo_bancos_dinamico e fn_saldo_composicao passam a derivar de
-- fn_saldo_gerencial_contas. Nada é alterado no dado (saldo inicial e flags a Jordana corrige pela tela).
-- =============================================================================

-- (1) Função única por conta — uma linha por conta + uma linha 'Sem conta' (conta_id NULL) por empresa.
CREATE OR REPLACE FUNCTION public.fn_saldo_gerencial_contas(p_company_ids uuid[])
 RETURNS TABLE(
   company_id uuid, conta_id uuid, nome text, tipo_conta text, soma_no_saldo boolean,
   saldo_inicial numeric, data_saldo_inicial date, recebido numeric, pago numeric,
   saldo_gerencial numeric, saldo_extrato numeric, diferenca numeric, n_titulos int)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ids uuid[];
BEGIN
  -- guarda de empresa (padrão get_user_company_ids); service role (auth.uid() NULL) passa
  IF auth.uid() IS NOT NULL THEN
    SELECT array_agg(x) INTO v_ids FROM unnest(p_company_ids) x WHERE x IN (SELECT get_user_company_ids());
  ELSE
    v_ids := p_company_ids;
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
  rec AS (
    SELECT c.id AS conta_id, SUM(COALESCE(er.valor_pago, er.valor)) AS v, count(*)::int AS n
    FROM contas c
    JOIN erp_receber er ON er.conta_bancaria_id = c.id
      AND er.deleted_at IS NULL AND er.data_pagamento IS NOT NULL
      AND er.status IN ('recebido','pago') AND er.data_pagamento >= c.dsi
    GROUP BY c.id
  ),
  pag AS (
    SELECT c.id AS conta_id, SUM(COALESCE(ep.valor_pago, ep.valor)) AS v, count(*)::int AS n
    FROM contas c
    JOIN erp_pagar ep ON lower(btrim(ep.conta_bancaria)) = c.nkey AND ep.company_id = c.cid
      AND ep.deleted_at IS NULL AND ep.data_pagamento IS NOT NULL
      AND ep.status = 'pago' AND ep.data_pagamento >= c.dsi
      AND (SELECT k.n FROM nkey_ct k WHERE k.cid = c.cid AND k.nkey = c.nkey) = 1  -- só quando o nome casa com UMA conta
    GROUP BY c.id
  ),
  sem AS (
    SELECT vid AS cid,
      COALESCE((SELECT SUM(COALESCE(er.valor_pago,er.valor)) FROM erp_receber er
         WHERE er.company_id = vid AND er.deleted_at IS NULL AND er.data_pagamento IS NOT NULL
           AND er.status IN ('recebido','pago') AND er.conta_bancaria_id IS NULL),0) AS rec_v,
      COALESCE((SELECT count(*) FROM erp_receber er
         WHERE er.company_id = vid AND er.deleted_at IS NULL AND er.data_pagamento IS NOT NULL
           AND er.status IN ('recebido','pago') AND er.conta_bancaria_id IS NULL),0)::int AS rec_n,
      COALESCE((SELECT SUM(COALESCE(ep.valor_pago,ep.valor)) FROM erp_pagar ep
         WHERE ep.company_id = vid AND ep.deleted_at IS NULL AND ep.data_pagamento IS NOT NULL AND ep.status = 'pago'
           AND COALESCE((SELECT k.n FROM nkey_ct k WHERE k.cid = vid AND k.nkey = lower(btrim(ep.conta_bancaria))),0) <> 1),0) AS pag_v,
      COALESCE((SELECT count(*) FROM erp_pagar ep
         WHERE ep.company_id = vid AND ep.deleted_at IS NULL AND ep.data_pagamento IS NOT NULL AND ep.status = 'pago'
           AND COALESCE((SELECT k.n FROM nkey_ct k WHERE k.cid = vid AND k.nkey = lower(btrim(ep.conta_bancaria))),0) <> 1),0)::int AS pag_n
    FROM unnest(v_ids) AS vid
  )
  SELECT c.cid, c.id, c.nm, c.tipo, c.soma, round(c.si,2), c.dsi,
         round(COALESCE(rec.v,0),2), round(COALESCE(pag.v,0),2),
         round(c.si + COALESCE(rec.v,0) - COALESCE(pag.v,0),2), c.se,
         CASE WHEN c.se IS NOT NULL THEN round((c.si + COALESCE(rec.v,0) - COALESCE(pag.v,0)) - c.se, 2) END,
         (COALESCE(rec.n,0) + COALESCE(pag.n,0))
  FROM contas c LEFT JOIN rec ON rec.conta_id = c.id LEFT JOIN pag ON pag.conta_id = c.id
  UNION ALL
  SELECT s.cid, NULL::uuid, 'Sem conta'::text, NULL::text, false, 0::numeric, NULL::date,
         round(s.rec_v,2), round(s.pag_v,2), round(s.rec_v - s.pag_v,2), NULL::numeric, NULL::numeric,
         (s.rec_n + s.pag_n)
  FROM sem s
  WHERE (s.rec_n + s.pag_n) > 0
  ORDER BY 1, 5 DESC, 3;
END $function$;

REVOKE EXECUTE ON FUNCTION public.fn_saldo_gerencial_contas(uuid[]) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_saldo_gerencial_contas(uuid[]) TO authenticated, service_role;

-- (2) fn_saldo_bancos_dinamico: agora é a SOMA das contas que somam (RD-65). Sem janela_dupla.
CREATE OR REPLACE FUNCTION public.fn_saldo_bancos_dinamico(p_company_ids uuid[])
 RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(g.saldo_gerencial), 0)
  FROM public.fn_saldo_gerencial_contas(p_company_ids) g
  WHERE g.conta_id IS NOT NULL AND g.soma_no_saldo = true;
$function$;

-- (3) fn_saldo_composicao: mesma fonte única. saldo_composto == saldo_gerencial (some a "janela dupla").
CREATE OR REPLACE FUNCTION public.fn_saldo_composicao(p_company_ids uuid[])
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ids uuid[]; v_data_efetiva date; v_contas jsonb; v_sem jsonb;
        v_ti numeric; v_tr numeric; v_tp numeric; v_ger numeric;
BEGIN
  IF auth.uid() IS NOT NULL THEN SELECT array_agg(x) INTO v_ids FROM unnest(p_company_ids) x WHERE x IN (SELECT get_user_company_ids());
  ELSE v_ids := p_company_ids; END IF;
  IF v_ids IS NULL OR array_length(v_ids,1) IS NULL THEN RETURN jsonb_build_object('sem_acesso', true); END IF;

  SELECT MIN(data_saldo_inicial) INTO v_data_efetiva
    FROM erp_banco_contas WHERE company_id = ANY(v_ids) AND ativo AND COALESCE(soma_no_saldo,true);

  -- por conta (só as que somam, como antes); cada conta já vem com sua data e o gerencial correto
  SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.saldo_inicial DESC) INTO v_contas FROM (
    SELECT g.conta_id, g.nome, g.saldo_inicial, g.data_saldo_inicial,
           false AS data_diverge_do_calculo,   -- não há mais janela por divergência de data
           g.recebido, g.pago, g.saldo_gerencial AS saldo, g.saldo_extrato, g.soma_no_saldo, g.n_titulos
    FROM public.fn_saldo_gerencial_contas(v_ids) g
    WHERE g.conta_id IS NOT NULL AND g.soma_no_saldo = true
  ) t;

  -- sem conta (linha conta_id NULL da função)
  SELECT jsonb_build_object('recebido', COALESCE(g.recebido,0), 'pago', COALESCE(g.pago,0), 'n_titulos', COALESCE(g.n_titulos,0))
    INTO v_sem
    FROM public.fn_saldo_gerencial_contas(v_ids) g WHERE g.conta_id IS NULL LIMIT 1;
  IF v_sem IS NULL THEN v_sem := jsonb_build_object('recebido',0,'pago',0,'n_titulos',0); END IF;

  SELECT COALESCE(SUM(saldo_inicial),0) INTO v_ti FROM erp_banco_contas WHERE company_id = ANY(v_ids) AND ativo AND COALESCE(soma_no_saldo,true);
  v_ger := public.fn_saldo_bancos_dinamico(v_ids);
  v_tr := COALESCE((SELECT SUM((c->>'recebido')::numeric) FROM jsonb_array_elements(COALESCE(v_contas,'[]')) c),0) + COALESCE((v_sem->>'recebido')::numeric,0);
  v_tp := COALESCE((SELECT SUM((c->>'pago')::numeric)     FROM jsonb_array_elements(COALESCE(v_contas,'[]')) c),0) + COALESCE((v_sem->>'pago')::numeric,0);

  RETURN jsonb_build_object('ok', true, 'data_efetiva_calculo_atual', v_data_efetiva,
    'contas', COALESCE(v_contas,'[]'::jsonb), 'sem_conta', v_sem,
    'total_saldo_inicial', v_ti, 'total_recebido', v_tr, 'total_pago', v_tp,
    'saldo_composto', COALESCE(v_ger,0), 'total_janela_subtraida', 0, 'saldo_gerencial_atual', COALESCE(v_ger,0));
END $function$;

-- (4) fn_saldos_empresa: cada conta na lista ganha 'gerencial'; e o topo ganha 'sem_conta' (total + contagem).
CREATE OR REPLACE FUNCTION public.fn_saldos_empresa(p_company_ids uuid[])
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
  v_banc_total numeric; v_banc_contas int; v_banc_sem int; v_lido_em timestamptz; v_origem text;
  v_ger numeric; v_caixa_total numeric; v_caixa_n int; v_cartao_total numeric; v_cartao_n int;
  v_pend int; v_ultima timestamptz; v_tem_extrato boolean; v_contas jsonb; v_sem_conta jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT array_agg(x) INTO v_ids FROM unnest(p_company_ids) x WHERE x IN (SELECT get_user_company_ids());
  ELSE
    v_ids := p_company_ids;
  END IF;
  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN RETURN jsonb_build_object('sem_acesso', true); END IF;

  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
                  WHERE company_id = ANY(v_ids) AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active') THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  SELECT
    COALESCE(SUM(saldo_extrato) FILTER (WHERE categoria = 'banco'), 0),
    COUNT(*) FILTER (WHERE categoria = 'banco' AND saldo_extrato IS NOT NULL),
    COUNT(*) FILTER (WHERE categoria = 'banco' AND saldo_extrato IS NULL),
    MAX(saldo_extrato_em) FILTER (WHERE categoria = 'banco'),
    COALESCE(SUM(saldo_atual) FILTER (WHERE categoria = 'caixa'), 0),
    COUNT(*) FILTER (WHERE categoria = 'caixa'),
    COALESCE(SUM(saldo_atual) FILTER (WHERE categoria = 'cartao'), 0),
    COUNT(*) FILTER (WHERE categoria = 'cartao')
  INTO v_banc_total, v_banc_contas, v_banc_sem, v_lido_em, v_caixa_total, v_caixa_n, v_cartao_total, v_cartao_n
  FROM (
    SELECT bc.saldo_extrato, bc.saldo_extrato_em, bc.saldo_atual,
      CASE
        WHEN bc.tipo_conta IN ('corrente','checking_account','investimento') THEN 'banco'
        WHEN bc.tipo_conta IN ('caixa','caixinha') THEN 'caixa'
        WHEN bc.tipo_conta = 'cartao' THEN 'cartao'
        ELSE 'controle'
      END AS categoria
    FROM erp_banco_contas bc
    WHERE bc.company_id = ANY(v_ids) AND bc.ativo = true AND COALESCE(bc.soma_no_saldo, true) = true
  ) t;

  SELECT saldo_extrato_origem INTO v_origem
    FROM erp_banco_contas
   WHERE company_id = ANY(v_ids) AND ativo = true AND saldo_extrato_em IS NOT NULL
     AND tipo_conta IN ('corrente','checking_account','investimento')
   ORDER BY saldo_extrato_em DESC LIMIT 1;

  v_ger := public.fn_saldo_bancos_dinamico(v_ids);

  SELECT EXISTS (SELECT 1 FROM conciliacao_lote cl JOIN erp_banco_contas bc ON bc.id = cl.conta_bancaria_id
     WHERE bc.company_id = ANY(v_ids)) INTO v_tem_extrato;

  SELECT COUNT(*) FILTER (WHERE status = 'pendente'), MAX(match_aplicado_em) FILTER (WHERE status = 'conciliado')
    INTO v_pend, v_ultima FROM conciliacao_movimento WHERE company_id = ANY(v_ids);

  -- lista de contas com a ORIGEM do saldo + o GERENCIAL por conta (fonte única fn_saldo_gerencial_contas)
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.categoria, x.nome), '[]'::jsonb) INTO v_contas
  FROM (
    SELECT bc.id, bc.nome, bc.tipo_conta,
      CASE
        WHEN bc.tipo_conta IN ('corrente','checking_account','investimento') THEN 'banco'
        WHEN bc.tipo_conta IN ('caixa','caixinha') THEN 'caixa'
        ELSE 'cartao'
      END AS categoria,
      CASE WHEN bc.tipo_conta IN ('corrente','checking_account','investimento')
           THEN bc.saldo_extrato ELSE bc.saldo_atual END AS saldo,
      CASE
        WHEN bc.tipo_conta IN ('corrente','checking_account','investimento')
          THEN (CASE WHEN bc.saldo_extrato IS NOT NULL THEN 'lido' ELSE 'sem_dado' END)
        ELSE 'manual'
      END AS saldo_origem,
      bc.saldo_extrato_em, bc.saldo_extrato_origem,
      g.saldo_gerencial AS gerencial,   -- NOVO: gerencial por conta ao lado do bancário
      COALESCE((SELECT COUNT(*) FROM conciliacao_lote cl WHERE cl.conta_bancaria_id = bc.id AND cl.status = 'pendente'), 0) AS conciliacoes_pendentes
    FROM erp_banco_contas bc
    LEFT JOIN public.fn_saldo_gerencial_contas(v_ids) g ON g.conta_id = bc.id
    WHERE bc.company_id = ANY(v_ids) AND bc.ativo = true AND COALESCE(bc.soma_no_saldo, true) = true
      AND bc.tipo_conta IN ('corrente','checking_account','investimento','caixa','caixinha','cartao')
  ) x;

  -- NOVO: bucket "sem conta" (títulos baixados sem conta / nome que não casa) — total + contagem
  SELECT jsonb_build_object('recebido', COALESCE(g.recebido,0), 'pago', COALESCE(g.pago,0),
                            'n_titulos', COALESCE(g.n_titulos,0), 'valor', COALESCE(g.recebido,0) - COALESCE(g.pago,0))
    INTO v_sem_conta
    FROM public.fn_saldo_gerencial_contas(v_ids) g WHERE g.conta_id IS NULL LIMIT 1;
  IF v_sem_conta IS NULL THEN v_sem_conta := jsonb_build_object('recebido',0,'pago',0,'n_titulos',0,'valor',0); END IF;

  RETURN jsonb_build_object(
    'sem_plano', false,
    'bancario', jsonb_build_object('total', v_banc_total, 'contas', v_banc_contas, 'contas_sem_leitura', v_banc_sem, 'lido_em', v_lido_em, 'origem', v_origem),
    'gerencial', jsonb_build_object('total', COALESCE(v_ger, 0)),
    'caixa',  jsonb_build_object('total', v_caixa_total, 'contas', v_caixa_n),
    'cartao', jsonb_build_object('total', v_cartao_total, 'contas', v_cartao_n),
    'tem_extrato', v_tem_extrato,
    'diferenca', CASE WHEN v_tem_extrato THEN jsonb_build_object(
       'valor', COALESCE(v_ger, 0) - v_banc_total, 'movimentos_pendentes', COALESCE(v_pend, 0), 'ultima_conciliacao', v_ultima::date) ELSE NULL END,
    'sem_conta', v_sem_conta,
    'contas', v_contas
  );
END $function$;
