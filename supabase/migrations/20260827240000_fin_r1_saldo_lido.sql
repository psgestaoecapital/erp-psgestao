-- SPEC FIN-R1 · SALDO BANCÁRIO LIDO, NÃO CALCULADO. Veredito da sonda #1156 (payload real 27/08 21:00):
-- o Sicoob v4 devolve `resultado.saldoAtual` (saldo da conta no momento da consulta) — não somamos nada.
--
-- Aditivo (RD-55): NÃO altera saldo_atual/saldo_inicial. Só adiciona campos, uma função de escrita e
-- uma função de leitura classificada. Auditado 27/08 (RD-44/45):
--   · erp_banco_contas usa `ativo` (não há deleted_at); tipo_conta classifica banco × caixa × cartão × controle;
--   · fn_saldo_bancos_dinamico(uuid[]) devolve UM número por empresa (saldo inicial + títulos liquidados) = o "gerencial";
--   · o saldo per-conta CALCULADO não existe hoje (títulos não têm conta_bancaria_id — isso é o R5), então
--     conta bancária sem leitura fica "—" (nunca R$ 0,00 — RD-51); o calculado aparece como card gerencial (company-wide).

-- ENTREGA 1 — campos de saldo lido (aditivo; colunas anuláveis, sem default → metadata-only)
ALTER TABLE public.erp_banco_contas
  ADD COLUMN IF NOT EXISTS saldo_extrato        numeric(14,2),
  ADD COLUMN IF NOT EXISTS saldo_extrato_em     timestamptz,
  ADD COLUMN IF NOT EXISTS saldo_extrato_origem text,   -- 'api_sicoob' | 'ofx' | 'api_pluggy' | 'manual'
  ADD COLUMN IF NOT EXISTS saldo_extrato_bruto  jsonb;  -- retrato dos campos de saldo (auditoria)

-- ENTREGA 2 — ÚNICO ponto de escrita do saldo lido. Nunca retrocede; nunca grava nulo.
-- Gate igual ao fn_sonda_saldo_registrar: service role (auth.uid() NULL) passa; usuário precisa da empresa.
CREATE OR REPLACE FUNCTION public.fn_banco_saldo_registrar(
  p_conta_id uuid,
  p_saldo    numeric,
  p_origem   text,
  p_bruto    jsonb DEFAULT NULL,
  p_lido_em  timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_company uuid; v_anterior numeric;
BEGIN
  SELECT company_id, saldo_extrato INTO v_company, v_anterior
    FROM erp_banco_contas WHERE id = p_conta_id;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'conta_nao_encontrada'); END IF;

  IF auth.uid() IS NOT NULL AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  IF p_saldo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'saldo_nulo'); END IF;

  -- nunca retroceder: só grava se a leitura for mais recente (ou igual) que a última gravada
  UPDATE erp_banco_contas
     SET saldo_extrato        = p_saldo,
         saldo_extrato_em     = p_lido_em,
         saldo_extrato_origem = p_origem,
         saldo_extrato_bruto  = COALESCE(p_bruto, saldo_extrato_bruto),
         updated_at           = now()
   WHERE id = p_conta_id
     AND (saldo_extrato_em IS NULL OR p_lido_em >= saldo_extrato_em);

  RETURN jsonb_build_object('ok', true, 'saldo_anterior', v_anterior,
                            'saldo_novo', p_saldo, 'origem', p_origem);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_banco_saldo_registrar(uuid, numeric, text, jsonb, timestamptz) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_banco_saldo_registrar(uuid, numeric, text, jsonb, timestamptz) TO authenticated, service_role;

-- ENTREGA 5 — a RPC que a tela consome: totais classificados por tipo_conta + lista de contas com origem.
-- bancário = soma dos saldos LIDOS (saldo_extrato) das contas de banco; gerencial = fn_saldo_bancos_dinamico;
-- caixa/cartão em cards separados; controle/permuta ficam fora de tudo. Diferença = gerencial − bancário.
CREATE OR REPLACE FUNCTION public.fn_saldos_empresa(p_company_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_ids uuid[];
  v_banc_total numeric; v_banc_contas int; v_banc_sem int; v_lido_em timestamptz; v_origem text;
  v_ger numeric; v_caixa_total numeric; v_caixa_n int; v_cartao_total numeric; v_cartao_n int;
  v_pend int; v_ultima timestamptz; v_tem_extrato boolean; v_contas jsonb;
BEGIN
  -- acesso: usuário só enxerga as empresas que pode; service role (auth.uid() NULL) passa
  IF auth.uid() IS NOT NULL THEN
    SELECT array_agg(x) INTO v_ids FROM unnest(p_company_ids) x WHERE x IN (SELECT get_user_company_ids());
  ELSE
    v_ids := p_company_ids;
  END IF;
  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('sem_acesso', true);
  END IF;

  -- plano (mesma regra do fn_ge_contas_resumo): se NENHUMA das empresas tem o plano → sem_plano
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
                  WHERE company_id = ANY(v_ids) AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active') THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  -- totais por categoria (classificação genérica por tipo_conta; checking_account tratado = corrente)
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

  -- origem da leitura mais recente (para o badge)
  SELECT saldo_extrato_origem INTO v_origem
    FROM erp_banco_contas
   WHERE company_id = ANY(v_ids) AND ativo = true AND saldo_extrato_em IS NOT NULL
     AND tipo_conta IN ('corrente','checking_account','investimento')
   ORDER BY saldo_extrato_em DESC LIMIT 1;

  -- gerencial = saldo inicial + títulos liquidados (company-wide), reutiliza a função canônica
  v_ger := public.fn_saldo_bancos_dinamico(v_ids);

  -- extrato importado? (guarda anti-ruído da faixa de diferença)
  SELECT EXISTS (
    SELECT 1 FROM conciliacao_lote cl JOIN erp_banco_contas bc ON bc.id = cl.conta_bancaria_id
     WHERE bc.company_id = ANY(v_ids)
  ) INTO v_tem_extrato;

  -- pendências de conciliação + última conciliação
  SELECT COUNT(*) FILTER (WHERE status = 'pendente'), MAX(match_aplicado_em) FILTER (WHERE status = 'conciliado')
    INTO v_pend, v_ultima
    FROM conciliacao_movimento WHERE company_id = ANY(v_ids);

  -- lista de contas (banco/caixa/cartão; controle/permuta ficam de fora) com origem do saldo
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
      bc.saldo_extrato_em,
      bc.saldo_extrato_origem,
      COALESCE((SELECT COUNT(*) FROM conciliacao_lote cl
                 WHERE cl.conta_bancaria_id = bc.id AND cl.status = 'pendente'), 0) AS conciliacoes_pendentes
    FROM erp_banco_contas bc
    WHERE bc.company_id = ANY(v_ids) AND bc.ativo = true AND COALESCE(bc.soma_no_saldo, true) = true
      AND bc.tipo_conta IN ('corrente','checking_account','investimento','caixa','caixinha','cartao')
  ) x;

  RETURN jsonb_build_object(
    'sem_plano', false,
    'bancario', jsonb_build_object(
       'total', v_banc_total, 'contas', v_banc_contas, 'contas_sem_leitura', v_banc_sem,
       'lido_em', v_lido_em, 'origem', v_origem),
    'gerencial', jsonb_build_object('total', COALESCE(v_ger, 0)),
    'caixa',  jsonb_build_object('total', v_caixa_total, 'contas', v_caixa_n),
    'cartao', jsonb_build_object('total', v_cartao_total, 'contas', v_cartao_n),
    'tem_extrato', v_tem_extrato,
    'diferenca', CASE WHEN v_tem_extrato THEN jsonb_build_object(
       'valor', COALESCE(v_ger, 0) - v_banc_total,
       'movimentos_pendentes', COALESCE(v_pend, 0),
       'ultima_conciliacao', v_ultima::date) ELSE NULL END,
    'contas', v_contas
  );
END $fn$;
REVOKE ALL ON FUNCTION public.fn_saldos_empresa(uuid[]) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_saldos_empresa(uuid[]) TO authenticated, service_role;
