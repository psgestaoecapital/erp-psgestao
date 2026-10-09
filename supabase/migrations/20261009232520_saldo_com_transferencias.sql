-- =============================================================================
-- Saldo por conta COM transferências entre contas (jordana-code · OK do CEO 07/10, msg 05a42d64 · chamado #23 ProPlay)
--
-- Antes: fn_saldo_gerencial_contas não lia erp_transferencia (fn_fluxo_caixa_diario lia, por conta) — saldo e
-- fluxo divergiam. Gean (8 transferências, R$ 109.604,00) e ProPlay (5, R$ 95.800,00) ficavam com dinheiro
-- "parado" na conta de origem e faltando na de destino.
--
-- Regra (a MESMA do fluxo por conta: entra na conta destino, sai da conta origem, pela data da transferência):
--   saldo da conta = saldo inicial + recebido − pago + transferências recebidas − transferências enviadas,
--   contando só o que tem data >= data do saldo inicial DAQUELA conta (o saldo inicial já contém o anterior),
--   títulos com deleted_at IS NULL.
-- Uma transferência entre duas contas com data depois das duas datas iniciais não muda o total (RD-83).
--
-- Um cálculo só (RD-65/RD-71): fn_saldo_transferencias_contas lista as transferências e diz, para cada lado,
-- se ela entra no saldo; fn_saldo_gerencial_contas soma dela e fn_saldo_composicao mostra a lista no
-- "Como é composto?". fn_saldo_bancos_dinamico e fn_saldos_empresa seguem derivando de fn_saldo_gerencial_contas.
-- Nada é alterado no dado.
-- =============================================================================

-- (1) Fonte única das transferências por lado (interna: só service_role e as funções SECURITY DEFINER abaixo).
CREATE OR REPLACE FUNCTION public.fn_saldo_transferencias_contas(p_company_ids uuid[])
 RETURNS TABLE(
   company_id uuid, transferencia_id uuid, data date, valor numeric, descricao text,
   conta_origem_id uuid, conta_origem_nome text, conta_destino_id uuid, conta_destino_nome text,
   conta_na_saida boolean, conta_na_entrada boolean)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT t.company_id, t.id, t.data, t.valor, t.descricao,
         o.id, o.nome::text, d.id, d.nome::text,
         -- sai da origem só se a transferência é da data do saldo inicial da origem em diante
         (o.ativo IS TRUE AND t.data >= COALESCE(o.data_saldo_inicial, '1900-01-01'::date)),
         -- entra no destino só se é da data do saldo inicial do destino em diante
         (d.ativo IS TRUE AND t.data >= COALESCE(d.data_saldo_inicial, '1900-01-01'::date))
  FROM erp_transferencia t
  JOIN erp_banco_contas o ON o.id = t.conta_origem_id AND o.company_id = t.company_id
  JOIN erp_banco_contas d ON d.id = t.conta_destino_id AND d.company_id = t.company_id
  WHERE t.company_id = ANY(p_company_ids);
$function$;

REVOKE ALL ON FUNCTION public.fn_saldo_transferencias_contas(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_saldo_transferencias_contas(uuid[]) TO service_role;

-- (2) Saldo por conta — mesmas colunas de antes + transf_entrada/transf_saida no fim (o tipo de retorno muda,
-- por isso DROP + CREATE; os chamadores são plpgsql/sql e leem as colunas pelo nome).
DROP FUNCTION IF EXISTS public.fn_saldo_gerencial_contas(uuid[]);

CREATE FUNCTION public.fn_saldo_gerencial_contas(p_company_ids uuid[])
 RETURNS TABLE(
   company_id uuid, conta_id uuid, nome text, tipo_conta text, soma_no_saldo boolean,
   saldo_inicial numeric, data_saldo_inicial date, recebido numeric, pago numeric,
   saldo_gerencial numeric, saldo_extrato numeric, diferenca numeric, n_titulos int,
   transf_entrada numeric, transf_saida numeric)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
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
      AND (SELECT k.n FROM nkey_ct k WHERE k.cid = c.cid AND k.nkey = c.nkey) = 1
    GROUP BY c.id
  ),
  tr AS (SELECT * FROM public.fn_saldo_transferencias_contas(v_ids)),
  te AS (SELECT tr.conta_destino_id AS conta_id, SUM(tr.valor) AS v FROM tr WHERE tr.conta_na_entrada GROUP BY 1),
  ts AS (SELECT tr.conta_origem_id AS conta_id, SUM(tr.valor) AS v FROM tr WHERE tr.conta_na_saida GROUP BY 1),
  sem AS (
    SELECT vid AS cid,
      COALESCE((SELECT SUM(COALESCE(er.valor_pago,er.valor)) FROM erp_receber er WHERE er.company_id = vid AND er.deleted_at IS NULL AND er.data_pagamento IS NOT NULL AND er.status IN ('recebido','pago') AND er.conta_bancaria_id IS NULL),0) AS rec_v,
      COALESCE((SELECT count(*) FROM erp_receber er WHERE er.company_id = vid AND er.deleted_at IS NULL AND er.data_pagamento IS NOT NULL AND er.status IN ('recebido','pago') AND er.conta_bancaria_id IS NULL),0)::int AS rec_n,
      COALESCE((SELECT SUM(COALESCE(ep.valor_pago,ep.valor)) FROM erp_pagar ep WHERE ep.company_id = vid AND ep.deleted_at IS NULL AND ep.data_pagamento IS NOT NULL AND ep.status = 'pago' AND COALESCE((SELECT k.n FROM nkey_ct k WHERE k.cid = vid AND k.nkey = lower(btrim(ep.conta_bancaria))),0) <> 1),0) AS pag_v,
      COALESCE((SELECT count(*) FROM erp_pagar ep WHERE ep.company_id = vid AND ep.deleted_at IS NULL AND ep.data_pagamento IS NOT NULL AND ep.status = 'pago' AND COALESCE((SELECT k.n FROM nkey_ct k WHERE k.cid = vid AND k.nkey = lower(btrim(ep.conta_bancaria))),0) <> 1),0)::int AS pag_n
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

-- (3) "Como é composto?" — por conta mostra as transferências e a lista (data, origem, destino, valor).
CREATE OR REPLACE FUNCTION public.fn_saldo_composicao(p_company_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ids uuid[]; v_data_efetiva date; v_contas jsonb; v_sem jsonb; v_ti numeric; v_tr numeric; v_tp numeric; v_ger numeric;
        v_te numeric; v_ts numeric; v_transf jsonb;
BEGIN
  IF coalesce(current_setting('request.jwt.claims', true), '') = '' OR auth.role() = 'service_role' THEN v_ids := p_company_ids;
  ELSE SELECT array_agg(x) INTO v_ids FROM unnest(p_company_ids) x WHERE x IN (SELECT get_user_company_ids()); END IF;
  IF v_ids IS NULL OR array_length(v_ids,1) IS NULL THEN RETURN jsonb_build_object('sem_acesso', true); END IF;
  SELECT MIN(data_saldo_inicial) INTO v_data_efetiva FROM erp_banco_contas WHERE company_id = ANY(v_ids) AND ativo AND COALESCE(soma_no_saldo,true);
  SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.saldo_inicial DESC) INTO v_contas FROM (
    SELECT g.conta_id, g.nome, g.saldo_inicial, g.data_saldo_inicial, false AS data_diverge_do_calculo, g.recebido, g.pago,
           g.transf_entrada, g.transf_saida, g.saldo_gerencial AS saldo, g.saldo_extrato, g.soma_no_saldo, g.n_titulos
    FROM public.fn_saldo_gerencial_contas(v_ids) g WHERE g.conta_id IS NOT NULL AND g.soma_no_saldo = true) t;
  SELECT jsonb_build_object('recebido', COALESCE(g.recebido,0), 'pago', COALESCE(g.pago,0), 'n_titulos', COALESCE(g.n_titulos,0)) INTO v_sem FROM public.fn_saldo_gerencial_contas(v_ids) g WHERE g.conta_id IS NULL LIMIT 1;
  IF v_sem IS NULL THEN v_sem := jsonb_build_object('recebido',0,'pago',0,'n_titulos',0); END IF;
  SELECT COALESCE(SUM(saldo_inicial),0) INTO v_ti FROM erp_banco_contas WHERE company_id = ANY(v_ids) AND ativo AND COALESCE(soma_no_saldo,true);
  v_ger := public.fn_saldo_bancos_dinamico(v_ids);
  v_tr := COALESCE((SELECT SUM((c->>'recebido')::numeric) FROM jsonb_array_elements(COALESCE(v_contas,'[]')) c),0) + COALESCE((v_sem->>'recebido')::numeric,0);
  v_tp := COALESCE((SELECT SUM((c->>'pago')::numeric) FROM jsonb_array_elements(COALESCE(v_contas,'[]')) c),0) + COALESCE((v_sem->>'pago')::numeric,0);
  v_te := COALESCE((SELECT SUM((c->>'transf_entrada')::numeric) FROM jsonb_array_elements(COALESCE(v_contas,'[]')) c),0);
  v_ts := COALESCE((SELECT SUM((c->>'transf_saida')::numeric) FROM jsonb_array_elements(COALESCE(v_contas,'[]')) c),0);
  -- lista das transferências que mexem em alguma conta que soma no saldo (com o que conta de cada lado)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', x.transferencia_id, 'data', x.data, 'valor', x.valor, 'descricao', x.descricao,
           'origem', x.conta_origem_nome, 'destino', x.conta_destino_nome,
           'conta_na_saida', x.conta_na_saida AND COALESCE(o.soma_no_saldo, true),
           'conta_na_entrada', x.conta_na_entrada AND COALESCE(d.soma_no_saldo, true))
         ORDER BY x.data DESC, x.valor DESC), '[]'::jsonb)
    INTO v_transf
  FROM public.fn_saldo_transferencias_contas(v_ids) x
  JOIN erp_banco_contas o ON o.id = x.conta_origem_id
  JOIN erp_banco_contas d ON d.id = x.conta_destino_id
  WHERE (x.conta_na_saida AND COALESCE(o.soma_no_saldo, true)) OR (x.conta_na_entrada AND COALESCE(d.soma_no_saldo, true));
  RETURN jsonb_build_object('ok', true, 'data_efetiva_calculo_atual', v_data_efetiva, 'contas', COALESCE(v_contas,'[]'::jsonb), 'sem_conta', v_sem,
    'total_saldo_inicial', v_ti, 'total_recebido', v_tr, 'total_pago', v_tp,
    'total_transferencias_entrada', v_te, 'total_transferencias_saida', v_ts, 'transferencias', v_transf,
    'saldo_composto', COALESCE(v_ger,0), 'total_janela_subtraida', 0, 'saldo_gerencial_atual', COALESCE(v_ger,0));
END $function$;

REVOKE ALL ON FUNCTION public.fn_saldo_composicao(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_saldo_composicao(uuid[]) TO authenticated, service_role;
