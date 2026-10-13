-- GE-SALDO-CONTAS · Card "Contas Financeiras" mostrava a MÉDIA (saldo_total ÷ nº contas), não o
-- saldo real de cada conta. Auditoria (RD-38): o frontend (ColunaContas/HeroSaldoBancario) já
-- renderiza c.saldo_atual — o bug estava DENTRO de fn_ge_contas_resumo, que rateava v_saldo_total
-- por conta (total/qtd quando saldo_inicial=0/igual → a média que o Rodrigo viu).
--
-- Correção (RD-51/RD-58 veracidade · RD-52 fonte única):
--   • saldo_atual de cada conta = bc.saldo_atual REAL (nunca rateio/média).
--   • saldo_total = SOMA dos saldo_atual reais das contas ativo=true E soma_no_saldo=true
--     (decisão do CEO 25/08: total = soma dos saldos reais, coerente com as linhas exibidas).
--     Antes vinha de fn_saldo_bancos_dinamico, que divergia da soma real (ex. R.R Serviços:
--     -19.884,01 dinâmico vs -7.756,07 soma real) e mascarava o valor por conta.
--   • Contas inativas (ativo=false, ex. Omie.CASH) e de controle/trânsito (soma_no_saldo=false,
--     ex. Transferências/Inadimplentes) continuam FORA da lista e do total.
-- Validado em BEGIN/ROLLBACK no tenant R.R Serviços (d1330faf): total=-7.756,07, qtd=5, cada conta
-- com seu saldo real (Sicoob 31.259,01 · Caixa 71,70 · MasterCard 0 · Bradesco 0 · Caixinha -39.086,78).

CREATE OR REPLACE FUNCTION public.fn_ge_contas_resumo(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_saldo_total numeric;
  v_qtd_contas int;
  v_contas jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id
      AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  -- total = SOMA dos saldos REAIS por conta (ativo + soma_no_saldo). Sem fn_saldo_bancos_dinamico
  -- e sem rateio — o topo (Hero) e as linhas (Contas Financeiras) batem sempre, tudo do banco.
  SELECT COUNT(*), COALESCE(SUM(COALESCE(saldo_atual, 0)), 0)
    INTO v_qtd_contas, v_saldo_total
  FROM erp_banco_contas
  WHERE company_id = p_company_id
    AND ativo = true
    AND COALESCE(soma_no_saldo, true) = true;

  -- cada conta com o SEU próprio saldo_atual (nunca média/rateio). Inativas e de controle/trânsito
  -- (soma_no_saldo=false: Transferências/Inadimplentes) ficam fora da lista.
  SELECT COALESCE(jsonb_agg(c ORDER BY (c->>'saldo_atual')::numeric DESC), '[]'::jsonb) INTO v_contas
  FROM (
    SELECT jsonb_build_object(
      'id', bc.id,
      'nome', bc.nome,
      'tipo_conta', bc.tipo_conta,
      'saldo_atual', COALESCE(bc.saldo_atual, 0),
      'ultima_importacao', bc.updated_at,
      'conciliacoes_pendentes', COALESCE((
        SELECT COUNT(*) FROM conciliacao_lote cl
        WHERE cl.conta_bancaria_id = bc.id AND cl.status = 'pendente'
      ), 0)
    ) AS c
    FROM erp_banco_contas bc
    WHERE bc.company_id = p_company_id
      AND bc.ativo = true
      AND COALESCE(bc.soma_no_saldo, true) = true
  ) sub;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'saldo_total', v_saldo_total,
    'qtd_contas', v_qtd_contas,
    'contas', v_contas
  );
END;
$function$;
