-- PDCA GE · /dashboard/financeiro/inadimplentes · code-desenvolvedor-3
-- Follow-up do fix da Saúde Financeira (#5294): alinhar a FAMÍLIA /inadimplentes ao
-- MESMO conjunto canônico (v_receber_efetivo) e ao SALDO, para todas as telas baterem.
--
-- PROBLEMA (RD-38 — DEMO "Comércio (GE)" b0700000-0000-4000-a000-000000000004, 18/11):
--   O conceito "vencido/inadimplente" diverge entre funções da mesma família:
--     • fn_inadimplentes_por_status  -> conjunto canônico + SALDO  -> 28 contas, R$ 101.991,27  (JÁ correto)
--     • fn_ge_saude_financeira (#5294) -> conjunto canônico + SALDO -> 28 contas, R$ 101.991,27  (corrigido na #5294)
--     • fn_ge_inadimplentes_agrupado -> erp_receber, status IN ('aberto','vencido'), BRUTO
--         -> 26 contas, R$ 101.002,02  (OMITE 2 títulos 'parcial' vencidos; soma BRUTO)
--     • fn_ge_top_inadimplentes -> erp_receber, status NOT IN ('recebido','pago') != 'orcamento', BRUTO
--         -> 31 contas, R$ 106.432,02  (INCLUI cancelado/renegociado indevidamente; soma BRUTO)
--
-- CORREÇÃO (aditiva — núcleo financeiro, NÃO altera dado de cliente; só CREATE OR REPLACE):
--   Alinhar as 2 funções ao conjunto canônico ÚNICO (idêntico a fn_inadimplentes_por_status e à Saúde):
--     FROM v_receber_efetivo (deleted_at IS NULL)
--     WHERE company_id = p AND data_vencimento < CURRENT_DATE
--       AND status NOT IN ('pago','recebido','cancelado','renegociado')
--       AND COALESCE(em_renegociacao,false) = false
--     VALOR = SALDO: (valor - COALESCE(valor_pago,0))  -- não superavalia títulos com baixa parcial
--   Resultado DEMO004: ambas passam a 28 contas, R$ 101.991,27 (SALDO) — reconcilia com
--   fn_inadimplentes_por_status, fn_ge_saude_financeira (#5294) e /receber "Vencidos" (#5286).
--
-- SEGURANÇA (RD-38 · tenant):
--   fn_ge_inadimplentes_agrupado era SECURITY DEFINER SEM a guarda de empresa — ao contrário das
--   irmãs (fn_inadimplentes_por_status, fn_ge_top_inadimplentes, fn_ge_saude_financeira, todas com
--   PERFORM fn__guarda_empresa). Isso deixava a leitura agrupada de inadimplência sem checar se o
--   auth.uid() pertence à empresa pedida. Esta migration ADICIONA PERFORM public.fn__guarda_empresa
--   no topo, fechando o vazamento cross-tenant e deixando a família consistente. SENSÍVEL ->
--   revisao-eng-chefe + @pos-migration verde.
--
-- ANTI-REGRESSÃO (preservado): mesmo shape de retorno (resumo/clientes, top/total_atrasados/...),
--   mesma ordenação, join com erp_clientes, COALESCE de cnpj/telefone/iniciais, score NULL,
--   checagem de plano GE, deleted_at IS NULL. A exclusão de orcamento/cancelado/renegociado
--   (de-dup de título substituído) é mantida pelo próprio filtro canônico.

-- ============================================================================
-- 1) fn_ge_inadimplentes_agrupado — conjunto canônico + SALDO + guarda de empresa
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_ge_inadimplentes_agrupado(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_resumo jsonb; v_clientes jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active') THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;
  WITH base AS (SELECT er.cliente_id, er.cliente_nome, er.id, er.descricao,
      (er.valor - COALESCE(er.valor_pago, 0)) AS valor, er.data_vencimento,
      (CURRENT_DATE - er.data_vencimento)::int AS dias_atraso
    FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) er
    WHERE er.company_id = p_company_id
      AND er.data_vencimento < CURRENT_DATE
      AND er.status NOT IN ('pago','recebido','cancelado','renegociado')
      AND COALESCE(er.em_renegociacao, false) = false)
  SELECT jsonb_build_object(
    'qtd_clientes', COALESCE((SELECT COUNT(DISTINCT COALESCE(cliente_id::text, cliente_nome, '')) FROM base), 0),
    'total_qtd_contas', COALESCE((SELECT COUNT(*) FROM base), 0),
    'total_valor', COALESCE((SELECT SUM(valor) FROM base), 0),
    'dias_max_atraso', COALESCE((SELECT MAX(dias_atraso) FROM base), 0)) INTO v_resumo;
  WITH base AS (SELECT er.cliente_id, er.cliente_nome, er.id AS conta_id, er.descricao,
      (er.valor - COALESCE(er.valor_pago, 0)) AS valor, er.data_vencimento,
      (CURRENT_DATE - er.data_vencimento)::int AS dias_atraso
    FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) er
    WHERE er.company_id = p_company_id
      AND er.data_vencimento < CURRENT_DATE
      AND er.status NOT IN ('pago','recebido','cancelado','renegociado')
      AND COALESCE(er.em_renegociacao, false) = false),
  por_cliente AS (SELECT cliente_id, cliente_nome, COUNT(*) AS qtd_contas, SUM(valor) AS valor_total,
      MAX(dias_atraso) AS dias_max_atraso, ROUND(AVG(dias_atraso))::int AS dias_medio_atraso,
      jsonb_agg(jsonb_build_object('id', conta_id, 'descricao', descricao, 'valor', valor,
        'vencimento', data_vencimento, 'dias_atraso', dias_atraso) ORDER BY data_vencimento) AS contas
    FROM base GROUP BY cliente_id, cliente_nome)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('cliente_id', pc.cliente_id, 'cliente_nome', pc.cliente_nome,
    'cnpj', COALESCE(c.cnpj_cpf, c.cpf_cnpj), 'telefone', COALESCE(c.celular, c.telefone),
    'whatsapp', c.whatsapp, 'email', c.email, 'qtd_contas', pc.qtd_contas, 'valor_total', pc.valor_total,
    'dias_max_atraso', pc.dias_max_atraso, 'dias_medio_atraso', pc.dias_medio_atraso, 'contas', pc.contas
  ) ORDER BY pc.dias_max_atraso DESC, pc.valor_total DESC), '[]'::jsonb) INTO v_clientes
  FROM por_cliente pc LEFT JOIN erp_clientes c ON c.id = pc.cliente_id;
  RETURN jsonb_build_object('company_id', p_company_id, 'resumo', v_resumo, 'clientes', v_clientes);
END; $function$;

-- ============================================================================
-- 2) fn_ge_top_inadimplentes — conjunto canônico + SALDO
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_ge_top_inadimplentes(p_company_id uuid, p_limit integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_top jsonb;
  v_total_atrasados int;
  v_total_valor numeric;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF NOT EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id
      AND plan_id = 'v15_gestao_empresarial_pro'
      AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  WITH atrasados AS (
    SELECT
      r.cliente_id,
      r.cliente_nome AS nome_pessoa,
      MAX(CURRENT_DATE - r.data_vencimento)::int AS dias_max_atraso,
      SUM(r.valor - COALESCE(r.valor_pago, 0)) AS valor_total,
      COUNT(*) AS qtd_lancamentos
    FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) r
    WHERE r.company_id = p_company_id
      AND r.data_vencimento < CURRENT_DATE
      AND r.status NOT IN ('pago', 'recebido', 'cancelado', 'renegociado')
      AND COALESCE(r.em_renegociacao, false) = false
    GROUP BY r.cliente_id, r.cliente_nome
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'cliente_id', cliente_id,
        'nome', nome_pessoa,
        'iniciais', UPPER(LEFT(SPLIT_PART(COALESCE(nome_pessoa, '?'), ' ', 1), 1) || COALESCE(LEFT(SPLIT_PART(COALESCE(nome_pessoa, ''), ' ', 2), 1), '')),
        'dias_atraso', dias_max_atraso,
        'valor_total', valor_total,
        'qtd_lancamentos', qtd_lancamentos,
        'score', NULL
      )
      ORDER BY dias_max_atraso DESC
    ), '[]'::jsonb),
    COUNT(*)::int,
    COALESCE(SUM(valor_total), 0)
  INTO v_top, v_total_atrasados, v_total_valor
  FROM (
    SELECT * FROM atrasados ORDER BY dias_max_atraso DESC LIMIT p_limit
  ) sub;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'top', v_top,
    'total_atrasados', v_total_atrasados,
    'total_valor', v_total_valor,
    'qtd_total_clientes_atrasados', (
      SELECT COUNT(DISTINCT cliente_id)
      FROM (SELECT * FROM public.v_receber_efetivo WHERE deleted_at IS NULL) er
      WHERE company_id = p_company_id
        AND data_vencimento < CURRENT_DATE
        AND status NOT IN ('pago', 'recebido', 'cancelado', 'renegociado')
        AND COALESCE(em_renegociacao, false) = false
    )
  );
END;
$function$;
