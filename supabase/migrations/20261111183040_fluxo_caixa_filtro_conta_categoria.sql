-- Núcleo · Financeiro › Fluxo de Caixa (/dashboard/financeiro/fluxo-caixa) · PDCA auditor_pdca_2 (aud8 92/95, tarefa 37c2b8df)
-- Gaps fechados:
--  1) CRÍTICO LATENTE (cálculo de dinheiro por conta): fn_fluxo_caixa_diario IGNORAVA a conta nos MOVIMENTOS quando
--     p_conta_id era informado — a condição `(p_conta_id IS NOT NULL OR NOT EXISTS(... incluir_no_fluxo=false))`
--     curto-circuitava para TRUE e NENHUM filtro por conta era aplicado (receb por er.conta_bancaria_id, pag por nome).
--     Hoje era latente (a tela passava p_conta_id=null fixo), mas viraria número ERRADO ao ligar o seletor de conta.
--     CORREÇÃO: quando p_conta_id é informado, receb filtra por er.conta_bancaria_id=p_conta_id e pag por
--     lower(ep.conta_bancaria)=lower(nome da conta); o caminho "Todas" (p_conta_id IS NULL) fica IDÊNTICO ao anterior.
--  2) Filtro por CATEGORIA (RD-99): novo parâmetro p_categoria. Vista de FLUXO da categoria — filtra as movimentações
--     por categoria; nesse modo o saldo inicial da conta NÃO entra (v_saldo_inicial=0, acumulado = líquido da categoria)
--     e transferências (sem categoria) são excluídas. "Todas as categorias" (NULL) = comportamento anterior.
--  3) RPC guardada fn_fluxo_caixa_filtros p/ popular os seletores (contas ativas + categorias usadas), guarda por empresa.
--  4) RD-95 "?" das novas chaves (conta, categoria, exportar, gráfico, nova movimentação) e RD-98 p3 (origem do dado).
-- ADITIVA/idempotente, não altera dado de cliente. Caminho "Todas × Todas" preservado byte a byte. Faixa code-desenvolvedor-3 (:40), acima da main.
-- SENSÍVEL: núcleo financeiro, CREATE OR REPLACE -> revisao-eng-chefe.

-- ── 1) fn_fluxo_caixa_diario: filtro por conta (fix) + por categoria (novo) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_fluxo_caixa_diario(
  p_company_id uuid,
  p_data_inicio date DEFAULT ((CURRENT_DATE - '30 days'::interval))::date,
  p_data_fim date DEFAULT ((CURRENT_DATE + '30 days'::interval))::date,
  p_conta_id uuid DEFAULT NULL::uuid,
  p_categoria text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_saldo_inicial numeric;
  v_data_saldo_inicial date;
  v_resultado jsonb := '[]'::jsonb;
  v_saldo_acumulado numeric;
  v_dia record;
  v_hoje date := CURRENT_DATE;
  v_primeiro_futuro date := GREATEST(CURRENT_DATE + 1, p_data_inicio);
  v_receber_vencido numeric;
  v_pagar_vencido numeric;
  v_conta_nome text;            -- nome da conta escolhida (erp_pagar liga por nome, não por id)
  v_categoria text := NULLIF(btrim(p_categoria), '');  -- '' = sem filtro
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);

  -- nome da conta escolhida (uma vez; erp_pagar.conta_bancaria é texto)
  IF p_conta_id IS NOT NULL THEN
    SELECT nome INTO v_conta_nome FROM erp_banco_contas WHERE id = p_conta_id AND company_id = p_company_id;
  END IF;

  -- Saldo inicial: só faz sentido na vista por conta/empresa. Na vista por CATEGORIA mostramos o fluxo líquido da
  -- categoria (acumulado começa em 0), porque o saldo bancário não pertence a uma categoria.
  IF v_categoria IS NULL THEN
    SELECT COALESCE(SUM(saldo_inicial), 0), MIN(data_saldo_inicial)
      INTO v_saldo_inicial, v_data_saldo_inicial
    FROM erp_banco_contas
    WHERE company_id = p_company_id AND ativo = true
      AND COALESCE(soma_no_saldo, true) = true
      AND (p_conta_id IS NULL OR id = p_conta_id);
  ELSE
    v_saldo_inicial := 0;
    v_data_saldo_inicial := NULL;
  END IF;

  v_saldo_acumulado := v_saldo_inicial;

  -- Vencidos em aberto (venc < hoje) — projetados no primeiro dia futuro como "em atraso".
  SELECT COALESCE(SUM(COALESCE(NULLIF(er.valor_pago, 0), er.valor, 0)), 0)
    INTO v_receber_vencido
  FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) er
  WHERE er.company_id = p_company_id AND er.data_vencimento < v_hoje
    AND er.status NOT IN ('pago', 'recebido', 'cancelado')
    AND (CASE WHEN p_conta_id IS NOT NULL THEN er.conta_bancaria_id = p_conta_id
              ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.id = er.conta_bancaria_id AND b.incluir_no_fluxo = false) END)
    AND (v_categoria IS NULL OR er.categoria = v_categoria);

  SELECT COALESCE(SUM(COALESCE(NULLIF(ep.valor_pago, 0), ep.valor, 0)), 0)
    INTO v_pagar_vencido
  FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) ep
  WHERE ep.company_id = p_company_id AND ep.data_vencimento < v_hoje
    AND ep.status NOT IN ('pago', 'cancelado')
    AND (CASE WHEN p_conta_id IS NOT NULL THEN lower(ep.conta_bancaria) = lower(v_conta_nome)
              ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.company_id = ep.company_id AND b.incluir_no_fluxo = false AND lower(b.nome) = lower(ep.conta_bancaria)) END)
    AND (v_categoria IS NULL OR ep.categoria = v_categoria);

  FOR v_dia IN
    SELECT
      d::date AS data,
      (d::date > v_hoje) AS eh_futuro,
      -- REALIZADO (histórico, por data_pagamento)
      COALESCE((SELECT SUM(COALESCE(NULLIF(er.valor_pago, 0), er.valor, 0))
                FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) er
                WHERE er.company_id = p_company_id AND er.data_pagamento = d::date
                  AND er.status IN ('pago', 'recebido')
                  AND (CASE WHEN p_conta_id IS NOT NULL THEN er.conta_bancaria_id = p_conta_id
                            ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.id = er.conta_bancaria_id AND b.incluir_no_fluxo = false) END)
                  AND (v_categoria IS NULL OR er.categoria = v_categoria)), 0) AS recebimentos,
      COALESCE((SELECT SUM(COALESCE(NULLIF(ep.valor_pago, 0), ep.valor, 0))
                FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) ep
                WHERE ep.company_id = p_company_id AND ep.data_pagamento = d::date
                  AND ep.status = 'pago'
                  AND (CASE WHEN p_conta_id IS NOT NULL THEN lower(ep.conta_bancaria) = lower(v_conta_nome)
                            ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.company_id = ep.company_id AND b.incluir_no_fluxo = false AND lower(b.nome) = lower(ep.conta_bancaria)) END)
                  AND (v_categoria IS NULL OR ep.categoria = v_categoria)), 0) AS pagamentos,
      -- PREVISTO (futuro, por data_vencimento, títulos em aberto)
      CASE WHEN d::date > v_hoje THEN
        COALESCE((SELECT SUM(COALESCE(NULLIF(er.valor_pago, 0), er.valor, 0))
                  FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) er
                  WHERE er.company_id = p_company_id AND er.data_vencimento = d::date
                    AND er.status NOT IN ('pago', 'recebido', 'cancelado')
                    AND (CASE WHEN p_conta_id IS NOT NULL THEN er.conta_bancaria_id = p_conta_id
                              ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.id = er.conta_bancaria_id AND b.incluir_no_fluxo = false) END)
                    AND (v_categoria IS NULL OR er.categoria = v_categoria)), 0)
        + CASE WHEN d::date = v_primeiro_futuro THEN v_receber_vencido ELSE 0 END
      ELSE 0 END AS recebimentos_previstos,
      CASE WHEN d::date > v_hoje THEN
        COALESCE((SELECT SUM(COALESCE(NULLIF(ep.valor_pago, 0), ep.valor, 0))
                  FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) ep
                  WHERE ep.company_id = p_company_id AND ep.data_vencimento = d::date
                    AND ep.status NOT IN ('pago', 'cancelado')
                    AND (CASE WHEN p_conta_id IS NOT NULL THEN lower(ep.conta_bancaria) = lower(v_conta_nome)
                              ELSE NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.company_id = ep.company_id AND b.incluir_no_fluxo = false AND lower(b.nome) = lower(ep.conta_bancaria)) END)
                    AND (v_categoria IS NULL OR ep.categoria = v_categoria)), 0)
        + CASE WHEN d::date = v_primeiro_futuro THEN v_pagar_vencido ELSE 0 END
      ELSE 0 END AS pagamentos_previstos,
      -- Transferências não têm categoria: na vista por categoria ficam zeradas.
      COALESCE((SELECT SUM(t.valor) FROM erp_transferencia t
                WHERE t.company_id = p_company_id AND t.data = d::date
                  AND v_categoria IS NULL AND p_conta_id IS NOT NULL AND t.conta_destino_id = p_conta_id), 0) AS transferencias_entrada,
      COALESCE((SELECT SUM(t.valor) FROM erp_transferencia t
                WHERE t.company_id = p_company_id AND t.data = d::date
                  AND v_categoria IS NULL AND p_conta_id IS NOT NULL AND t.conta_origem_id = p_conta_id), 0) AS transferencias_saida
    FROM generate_series(p_data_inicio, p_data_fim, INTERVAL '1 day') AS d
  LOOP
    v_saldo_acumulado := v_saldo_acumulado
                         + v_dia.recebimentos - v_dia.pagamentos
                         + v_dia.recebimentos_previstos - v_dia.pagamentos_previstos
                         + v_dia.transferencias_entrada - v_dia.transferencias_saida;

    v_resultado := v_resultado || jsonb_build_object(
      'data', v_dia.data,
      'eh_futuro', v_dia.eh_futuro,
      'recebimentos', v_dia.recebimentos,
      'pagamentos', v_dia.pagamentos,
      'recebimentos_previstos', v_dia.recebimentos_previstos,
      'pagamentos_previstos', v_dia.pagamentos_previstos,
      'transferencias_entrada', v_dia.transferencias_entrada,
      'transferencias_saida', v_dia.transferencias_saida,
      'movimento_dia', v_dia.recebimentos - v_dia.pagamentos
                       + v_dia.recebimentos_previstos - v_dia.pagamentos_previstos
                       + v_dia.transferencias_entrada - v_dia.transferencias_saida,
      'saldo_final', v_saldo_acumulado
    );
  END LOOP;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'periodo', jsonb_build_object('inicio', p_data_inicio, 'fim', p_data_fim),
    'hoje', v_hoje,
    'conta_id', p_conta_id,
    'categoria', v_categoria,
    'saldo_inicial', v_saldo_inicial,
    'saldo_final', v_saldo_acumulado,
    'total_recebimentos', (SELECT COALESCE(SUM((d ->> 'recebimentos')::numeric), 0) FROM jsonb_array_elements(v_resultado) d),
    'total_pagamentos', (SELECT COALESCE(SUM((d ->> 'pagamentos')::numeric), 0) FROM jsonb_array_elements(v_resultado) d),
    'total_recebimentos_previstos', (SELECT COALESCE(SUM((d ->> 'recebimentos_previstos')::numeric), 0) FROM jsonb_array_elements(v_resultado) d),
    'total_pagamentos_previstos', (SELECT COALESCE(SUM((d ->> 'pagamentos_previstos')::numeric), 0) FROM jsonb_array_elements(v_resultado) d),
    'total_receber_vencido_aberto', v_receber_vencido,
    'total_pagar_vencido_aberto', v_pagar_vencido,
    'total_transferencias_entrada', (SELECT COALESCE(SUM((d ->> 'transferencias_entrada')::numeric), 0) FROM jsonb_array_elements(v_resultado) d),
    'total_transferencias_saida', (SELECT COALESCE(SUM((d ->> 'transferencias_saida')::numeric), 0) FROM jsonb_array_elements(v_resultado) d),
    'movimento_liquido', v_saldo_acumulado - v_saldo_inicial,
    'dias', v_resultado
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_fluxo_caixa_diario(uuid, date, date, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_fluxo_caixa_diario(uuid, date, date, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_fluxo_caixa_diario(uuid, date, date, uuid, text) TO authenticated, service_role;

-- ── 2) fn_fluxo_caixa_filtros: contas ativas + categorias usadas (para os seletores) ───────────────────────────
CREATE OR REPLACE FUNCTION public.fn_fluxo_caixa_filtros(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  SELECT jsonb_build_object(
    'contas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', nome) ORDER BY nome)
                        FROM erp_banco_contas
                        WHERE company_id = p_company_id AND ativo = true), '[]'::jsonb),
    'categorias', COALESCE((SELECT jsonb_agg(c ORDER BY c) FROM (
                        SELECT DISTINCT btrim(categoria) AS c FROM (
                          SELECT categoria FROM erp_receber WHERE company_id = p_company_id AND deleted_at IS NULL
                          UNION ALL
                          SELECT categoria FROM erp_pagar   WHERE company_id = p_company_id AND deleted_at IS NULL
                        ) u
                        WHERE categoria IS NOT NULL AND btrim(categoria) <> ''
                      ) s), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_fluxo_caixa_filtros(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_fluxo_caixa_filtros(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_fluxo_caixa_filtros(uuid) TO authenticated, service_role;

-- ── 3) RD-95 "?" das novas chaves (idempotente) ────────────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/financeiro/fluxo-caixa', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('ge.fluxo_caixa.filtro_conta','Filtros','Conta','Escolha uma conta bancária para ver só o fluxo dela, ou deixe "Todas as contas".','Isola o caixa de uma conta específica — entradas, saídas e saldo só dela.','"Conta Corrente" mostra apenas o que passou por essa conta.','Esperar o saldo de "Todas" ao filtrar uma conta: ele muda, passa a ser o saldo só daquela conta.',20),
 ('ge.fluxo_caixa.filtro_categoria','Filtros','Categoria','Escolha uma categoria para ver só as movimentações dela, ou "Todas as categorias".','Mostra quanto entrou e saiu de uma categoria no período (vista de fluxo da categoria).','"Aluguel" mostra só as saídas dessa categoria.','Ao filtrar categoria o saldo bancário some: a vista passa a ser só o fluxo líquido da categoria (transferências não entram).',21),
 ('ge.fluxo_caixa.nova_movimentacao','Ações','Nova movimentação','Clique para lançar uma receita ou uma despesa sem sair do fluxo.','Registra uma entrada/saída que aparece no fluxo assim que for salva.','Lance a conta de luz como despesa e ela entra no fluxo.','Lançar no lugar errado: receita é entrada, despesa é saída.',22),
 ('ge.fluxo_caixa.exportar','Ações','Exportar','Clique para baixar as movimentações do período em CSV (abre no Excel/planilha).','Leva o fluxo para uma planilha para conferência ou envio ao contador.','Exporta os 30 dias para revisar com o contador.','Abrir o CSV com separador errado: o arquivo usa ";" (padrão BR).',23),
 ('ge.fluxo_caixa.grafico','Gráficos','Saldo dia a dia','Nada a preencher: a curva mostra a evolução do saldo (sólida = realizado, tracejada = previsto).','Enxerga a tendência do caixa e quando ele aperta.','A curva caindo após o dia 20 indica saldo apertando.','Confundir previsto (tracejado) com realizado: o previsto só acontece se os títulos forem pagos.',24)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);

-- ── 4) RD-98 p3 · origem do dado: acrescenta a RPC de filtros à rota (idempotente) ─────────────────────────────
UPDATE public.system_screens
   SET rpcs_chamadas = array_append(COALESCE(rpcs_chamadas, ARRAY[]::text[]), 'fn_fluxo_caixa_filtros')
 WHERE rota = '/dashboard/financeiro/fluxo-caixa'
   AND NOT ('fn_fluxo_caixa_filtros' = ANY (COALESCE(rpcs_chamadas, ARRAY[]::text[])));
