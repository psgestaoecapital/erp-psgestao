-- #9418 (jordana-chat / Canal PS) — Conciliação: sugerir o agrupamento dos boletos
-- liquidados por API para um crédito único do banco (ex.: Sicredi "LIQ.COBRANCA ...COBnnnnnn").
--
-- F1 (este arquivo): função SÓ-LEITURA que reconhece o crédito de liquidação de cobrança e
-- devolve o POOL de boletos liquidados (mesma empresa + mesma conta) ainda não conciliados,
-- pagos na janela de até 4 dias anteriores ao crédito (cobre fim de semana/feriado), com a
-- soma e o alvo. NUNCA concilia sozinho: a tela (F2) mostra os candidatos, o usuário marca o
-- subconjunto que fecha o valor e confirma (fn_conciliacao_fechar_agrupado, RD-26).
-- Espelha fn_conciliacao_lote_remessa_candidatos (débito de remessa) — mesmo padrão, lado crédito.
--
-- Aditiva, read-only (nenhum UPDATE/DELETE), company-scoped (get_user_company_ids/is_admin),
-- SECURITY DEFINER com REVOKE anon. RD-38: provado na Pdois (crédito COB000008 R$9.617,00 11/11
-- devolve o pool de boletos liquidados da conta na janela).

CREATE OR REPLACE FUNCTION public.fn_conciliacao_lote_liquidacao_candidatos(p_movimento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mov   RECORD;
  v_conta uuid;
  v_nn    int;
  v_itens jsonb;
  v_qtd   int;
  v_soma  numeric;
  v_alvo  numeric;
  v_janela int := 4;   -- dias anteriores ao crédito (o banco credita no dia útil seguinte)
BEGIN
  SELECT * INTO v_mov FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'movimento_nao_encontrado');
  END IF;
  IF NOT (v_mov.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  -- só CRÉDITO (recebimento): liquidação de cobrança entra positiva no extrato.
  IF COALESCE(v_mov.valor, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'aplicavel', false);
  END IF;

  -- reconhece o crédito de liquidação de cobrança. Sicredi: "LIQ.COBRANCA SIMPLES-COBnnnnnn".
  -- Genérico p/ outros bancos: descrição com LIQUID... + COBRANC... (tarifa "TARIFA ... LIQUIDACAO"
  -- NÃO casa, pois não tem COBRANC e é débito — já barrado pelo valor <= 0 acima).
  IF COALESCE(v_mov.descricao, '') !~* 'LIQ.*COBRANC' THEN
    RETURN jsonb_build_object('ok', true, 'aplicavel', false);
  END IF;
  -- NN = quantidade de boletos do crédito, quando o nome traz "COB0...NN" (filtro de contagem).
  v_nn := NULLIF((regexp_match(v_mov.descricao, 'COB0*([0-9]+)'))[1], '')::int;

  v_alvo := round(abs(v_mov.valor), 2);

  -- conta bancária do lote do movimento (só casa boletos liquidados NESSA conta)
  SELECT conta_bancaria_id INTO v_conta FROM conciliacao_lote WHERE id = v_mov.lote_id;

  WITH pool AS (
    SELECT r.id,
           r.cliente_nome,
           -- valor recebido = o que o banco creditou (valor_pago) quando houver; senão líquido
           round(COALESCE(NULLIF(r.valor_pago, 0),
                          r.valor + COALESCE(r.juros, 0) - COALESCE(r.desconto, 0)), 2) AS valor_recebido,
           r.boleto_pago_em,
           r.data_vencimento
      FROM erp_receber r
     WHERE r.company_id = v_mov.company_id
       AND r.boleto_status = 'liquidado'
       AND COALESCE(r.conciliado, false) = false
       AND r.deleted_at IS NULL
       AND (v_conta IS NULL OR r.conta_bancaria_id = v_conta)
       AND r.boleto_pago_em IS NOT NULL
       AND r.boleto_pago_em::date BETWEEN (v_mov.data_transacao::date - v_janela)
                                      AND  v_mov.data_transacao::date
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'lancamento_id',    id,
             'lancamento_tabela','erp_receber',
             'cliente',          cliente_nome,
             'valor',            valor_recebido,
             'pago_em',          boleto_pago_em,
             'vencimento',       data_vencimento)
           ORDER BY boleto_pago_em, cliente_nome), '[]'::jsonb),
         count(*),
         COALESCE(sum(valor_recebido), 0)
    INTO v_itens, v_qtd, v_soma
    FROM pool;

  RETURN jsonb_build_object(
    'ok',              true,
    'aplicavel',       true,
    'tipo',            'liquidacao_cobranca',
    'nn',              v_nn,
    'valor_movimento', v_alvo,
    'qtd_candidatos',  v_qtd,
    'soma_candidatos', v_soma,
    'diferenca',       round(v_soma - v_alvo, 2),
    'janela_dias',     v_janela,
    -- fecha_exato: o POOL inteiro já é o grupo (caso comum — qtd = NN e soma = valor).
    -- Quando o pool é superconjunto (há boletos de outro crédito na janela), vem false e a
    -- tela deixa o usuário escolher o subconjunto que fecha o alvo (nunca concilia sozinho).
    'fecha_exato',     (v_qtd > 0
                        AND (v_nn IS NULL OR v_qtd = v_nn)
                        AND abs(v_soma - v_alvo) <= 0.05),
    'itens',           v_itens);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_conciliacao_lote_liquidacao_candidatos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_lote_liquidacao_candidatos(uuid) TO authenticated, service_role;
