-- Razão Financeiro (GE tela 124 · T045) — RPC consolidada de performance (RD-99 simplicidade).
-- Motivo (auditoria auditor_pdca_2 26/11, GAP B): a tela fazia UMA ida ao banco por conta no load
-- (contas.map(rpc fn_ge_extrato_conta) dentro de Promise.all) — 20–50 round-trips por abertura numa
-- empresa real; 211 na DEMO. Esta função devolve, EM UMA PASSADA set-based, os totalizadores por conta
-- (saldo_anterior · entradas · saídas · saldo_atual · nº de lançamentos). A tela passa a 1 chamada no load
-- e carrega os movimentos da conta só ao expandir (fn_ge_extrato_conta daquela conta).
--
-- Sem regra financeira nova: replica EXATAMENTE a mesma lógica de saldo provada de fn_ge_extrato_conta
-- (saldo_base por conta ativa com soma_no_saldo; âncora = data_saldo_inicial; saldo_anterior = base +
-- recebido(<=inicio-1) − pago(<=inicio-1) − [âncora? recebido(<=âncora)−pago(<=âncora)]; vínculo de
-- erp_pagar por nome, erp_receber por conta_bancaria_id OU por nome quando o id é nulo; soft-delete
-- respeitado). Somente-leitura, SECURITY DEFINER com a mesma guarda de empresa e checagem de plano.
--
-- RD-38 (provado no dado, BEGIN…ROLLBACK, statement_timeout curto): conta a conta em 2 empresas REAIS
-- (36b69d77-… 4 contas; d1330faf-… 7 contas), os 4 totalizadores + nº de lançamentos batem 100% com
-- fn_ge_extrato_conta (11/11 contas, 0 divergência). Não varre a DEMO (196k linhas) por conta — set-based,
-- uma passada por erp_receber e uma por erp_pagar.

CREATE OR REPLACE FUNCTION public.fn_ge_razao_contas(
  p_company_id uuid,
  p_data_inicio date DEFAULT NULL,
  p_data_fim date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_di date := COALESCE(p_data_inicio, CURRENT_DATE - 30);
  v_df date := COALESCE(p_data_fim, CURRENT_DATE);
  v_contas jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);

  IF NOT EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  WITH contas AS (
    -- contas ativas da empresa (mesmo recorte do Extrato/Razão). base/âncora só valem quando soma_no_saldo.
    SELECT b.id, b.nome,
      CASE WHEN b.soma_no_saldo THEN COALESCE(b.saldo_inicial, 0) ELSE 0 END AS base,
      CASE WHEN b.soma_no_saldo THEN b.data_saldo_inicial ELSE NULL END AS ancora
    FROM erp_banco_contas b
    WHERE b.company_id = p_company_id AND b.ativo
  ),
  rec AS (
    -- recebidos casados por conta (id OU nome quando o id é nulo), uma passada
    SELECT a.id AS conta_id,
      COALESCE(SUM(COALESCE(r.valor_pago, r.valor)) FILTER (WHERE r.data_pagamento <= v_di - 1), 0) AS r_ate_inicio,
      COALESCE(SUM(COALESCE(r.valor_pago, r.valor)) FILTER (WHERE a.ancora IS NOT NULL AND r.data_pagamento <= a.ancora), 0) AS r_ate_ancora,
      COALESCE(SUM(COALESCE(r.valor_pago, r.valor)) FILTER (WHERE r.data_pagamento BETWEEN v_di AND v_df), 0) AS r_periodo,
      COUNT(*) FILTER (WHERE r.data_pagamento BETWEEN v_di AND v_df AND COALESCE(r.valor_pago, r.valor) <> 0) AS n_rec
    FROM contas a
    JOIN erp_receber r
      ON r.company_id = p_company_id AND r.deleted_at IS NULL AND r.status IN ('recebido', 'pago')
      AND (r.conta_bancaria_id = a.id OR (r.conta_bancaria_id IS NULL AND r.conta_bancaria = a.nome))
    GROUP BY a.id
  ),
  pag AS (
    -- pagos casados por conta (vínculo por nome, como no Extrato), uma passada
    SELECT a.id AS conta_id,
      COALESCE(SUM(COALESCE(p.valor_pago, p.valor)) FILTER (WHERE p.data_pagamento <= v_di - 1), 0) AS p_ate_inicio,
      COALESCE(SUM(COALESCE(p.valor_pago, p.valor)) FILTER (WHERE a.ancora IS NOT NULL AND p.data_pagamento <= a.ancora), 0) AS p_ate_ancora,
      COALESCE(SUM(COALESCE(p.valor_pago, p.valor)) FILTER (WHERE p.data_pagamento BETWEEN v_di AND v_df), 0) AS p_periodo,
      COUNT(*) FILTER (WHERE p.data_pagamento BETWEEN v_di AND v_df AND COALESCE(p.valor_pago, p.valor) <> 0) AS n_pag
    FROM contas a
    JOIN erp_pagar p
      ON p.company_id = p_company_id AND p.deleted_at IS NULL AND p.status = 'pago'
      AND p.conta_bancaria = a.nome
    GROUP BY a.id
  ),
  final AS (
    SELECT a.id, a.nome,
      (a.base + COALESCE(rec.r_ate_inicio, 0) - COALESCE(pag.p_ate_inicio, 0)
        - CASE WHEN a.ancora IS NOT NULL THEN (COALESCE(rec.r_ate_ancora, 0) - COALESCE(pag.p_ate_ancora, 0)) ELSE 0 END
      ) AS saldo_anterior,
      COALESCE(rec.r_periodo, 0) AS total_entradas,
      COALESCE(pag.p_periodo, 0) AS total_saidas,
      COALESCE(rec.n_rec, 0) + COALESCE(pag.n_pag, 0) AS n_lancamentos
    FROM contas a
    LEFT JOIN rec ON rec.conta_id = a.id
    LEFT JOIN pag ON pag.conta_id = a.id
  )
  SELECT jsonb_agg(jsonb_build_object(
    'conta_id', f.id,
    'conta_nome', f.nome,
    'saldo_anterior', f.saldo_anterior,
    'total_entradas', f.total_entradas,
    'total_saidas', f.total_saidas,
    'saldo_atual', f.saldo_anterior + f.total_entradas - f.total_saidas,
    'n_lancamentos', f.n_lancamentos
  ) ORDER BY f.nome)
  INTO v_contas
  FROM final f;

  RETURN jsonb_build_object(
    'periodo', jsonb_build_object('inicio', v_di, 'fim', v_df),
    'contas', COALESCE(v_contas, '[]'::jsonb)
  );
END;
$function$;

-- Somente usuário logado (a guarda de empresa + plano decide o acesso efetivo). REVOKE anon explícito (gate check_fn_guards).
REVOKE ALL ON FUNCTION public.fn_ge_razao_contas(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_razao_contas(uuid, date, date) TO authenticated, service_role;
