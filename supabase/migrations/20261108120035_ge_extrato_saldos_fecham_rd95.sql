-- Gestão Empresarial · Extrato Conta Corrente (/dashboard/financeiro/extrato · fn_ge_extrato_conta)
-- aud8 60/95 (matriz #2634). GAP CRÍTICO: os 4 cartões NÃO fechavam na tela — o usuário não conseguia conferir o extrato.
--   "Saldo inicial" mostrava o saldo_base (abertura da conta, ancorado na data_saldo_inicial, que pode ser muito antiga),
--   mas o "Saldo atual" era construído a partir do saldo_anterior (saldo no INÍCIO do período filtrado). Como as duas
--   âncoras eram diferentes, saldo_inicial + entradas - saídas ≠ saldo final exibido.
-- Além disso havia uma INCONSISTÊNCIA real no RPC: quando nenhuma conta tem data_saldo_inicial (data_ancora IS NULL — o
--   caso comum), o ramo NULL NÃO somava o saldo de abertura (saldo_base) no saldo corrente, enquanto o ramo ELSE somava.
--   Resultado: o saldo de abertura que a empresa configurou (ex.: R$ 15.500,00 na DEMO) sumia do saldo acumulado e do
--   saldo final. Este patch alinha o ramo NULL ao ELSE: o saldo de abertura passa a compor SEMPRE o saldo corrente.
--
-- Prova RD-38 (BEGIN/ROLLBACK, DEMO "Comércio (GE)" b0700000-...-0004, timeout 25s):
--   ANTES  (30d):  saldo_base 15.500 + entradas 831.220 − saídas 1.163.903,34 ≠ saldo_atual 1.134.949,08 (não fecha)
--   DEPOIS (30d):  saldo_anterior 1.483.132,42 + entradas 831.220 − saídas 1.163.903,34 = saldo_atual 1.150.449,08 (fecha)
--   DEPOIS (tudo): saldo_anterior 15.500,00 + ... = saldo_atual 1.150.449,08 (abertura incluída; mesmo saldo final nos
--                  dois períodos → consistente). Diferença vs. antes = exatamente os 15.500 de abertura que voltaram.
--
-- SENSÍVEL (RD-94.1): CREATE OR REPLACE de função financeira existente → revisao-eng-chefe. Só leitura (SECURITY DEFINER,
-- sem UPDATE/DELETE), não toca dado de cliente. Idempotente. Faixa de segundos do code-desenvolvedor-3 (:35).

-- 1) Correção do RPC: saldo de abertura SEMPRE no saldo corrente (ramo NULL alinhado ao ELSE).
CREATE OR REPLACE FUNCTION public.fn_ge_extrato_conta(p_company_id uuid, p_conta_id uuid DEFAULT NULL::uuid, p_data_inicio date DEFAULT NULL::date, p_data_fim date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_data_inicio date := COALESCE(p_data_inicio, CURRENT_DATE - 30);
  v_data_fim date := COALESCE(p_data_fim, CURRENT_DATE);
  v_saldo_base numeric := 0;
  v_data_ancora date;
  v_saldo_anterior numeric := 0;
  v_total_entradas numeric := 0;
  v_total_saidas numeric := 0;
  v_c_inicio numeric := 0;
  v_c_ancora numeric := 0;
  v_resultados jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  SELECT COALESCE(SUM(saldo_inicial),0), MIN(data_saldo_inicial)
    INTO v_saldo_base, v_data_ancora
  FROM erp_banco_contas
  WHERE company_id = p_company_id AND ativo AND soma_no_saldo
    AND (p_conta_id IS NULL OR id = p_conta_id);

  IF v_data_ancora IS NULL THEN
    -- Sem data de âncora: o saldo de abertura vale desde sempre. Saldo no início do período =
    -- abertura + (recebidos antes do início) − (pagos antes do início). (Antes faltava v_saldo_base aqui.)
    SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) INTO v_c_inicio
      FROM erp_receber
      WHERE company_id = p_company_id AND status IN ('recebido','pago') AND data_pagamento < v_data_inicio;
    SELECT v_saldo_base + v_c_inicio - COALESCE(SUM(COALESCE(valor_pago, valor)),0) INTO v_saldo_anterior
      FROM erp_pagar
      WHERE company_id = p_company_id AND status = 'pago' AND data_pagamento < v_data_inicio;
  ELSE
    v_c_inicio :=
        (SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) FROM erp_receber
          WHERE company_id=p_company_id AND status IN ('recebido','pago') AND data_pagamento <= v_data_inicio - 1)
      - (SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) FROM erp_pagar
          WHERE company_id=p_company_id AND status='pago' AND data_pagamento <= v_data_inicio - 1);
    v_c_ancora :=
        (SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) FROM erp_receber
          WHERE company_id=p_company_id AND status IN ('recebido','pago') AND data_pagamento <= v_data_ancora)
      - (SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) FROM erp_pagar
          WHERE company_id=p_company_id AND status='pago' AND data_pagamento <= v_data_ancora);
    v_saldo_anterior := v_saldo_base + v_c_inicio - v_c_ancora;
  END IF;

  SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) INTO v_total_entradas
    FROM erp_receber
    WHERE company_id = p_company_id AND status IN ('recebido','pago')
      AND data_pagamento BETWEEN v_data_inicio AND v_data_fim;
  SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) INTO v_total_saidas
    FROM erp_pagar
    WHERE company_id = p_company_id AND status = 'pago'
      AND data_pagamento BETWEEN v_data_inicio AND v_data_fim;

  WITH movimentos AS (
    SELECT id, 'receita' AS tipo, descricao, cliente_nome AS nome_pessoa, categoria, numero_documento,
      forma_pagamento, status, parcela, COALESCE(valor_pago, valor) AS valor,
      data_pagamento AS data, COALESCE(valor_pago, valor) AS sinal
    FROM erp_receber
    WHERE company_id = p_company_id AND status IN ('recebido','pago')
      AND data_pagamento BETWEEN v_data_inicio AND v_data_fim
      AND COALESCE(valor_pago, valor) <> 0
    UNION ALL
    SELECT id, 'despesa', descricao, fornecedor_nome, categoria, numero_documento,
      forma_pagamento, status, parcela, COALESCE(valor_pago, valor),
      data_pagamento, -COALESCE(valor_pago, valor)
    FROM erp_pagar
    WHERE company_id = p_company_id AND status = 'pago'
      AND data_pagamento BETWEEN v_data_inicio AND v_data_fim
      AND COALESCE(valor_pago, valor) <> 0
    LIMIT 500
  ),
  com_saldo AS (
    SELECT *, v_saldo_anterior + SUM(sinal) OVER (ORDER BY data, id ROWS UNBOUNDED PRECEDING) AS saldo_acumulado
    FROM movimentos
  )
  SELECT jsonb_agg(row_to_json(a) ORDER BY a.data DESC, a.id DESC) INTO v_resultados FROM com_saldo a;

  RETURN jsonb_build_object(
    'periodo', jsonb_build_object('inicio', v_data_inicio, 'fim', v_data_fim),
    'totalizadores', jsonb_build_object(
      'saldo_anterior', v_saldo_anterior,
      'total_entradas', v_total_entradas,
      'total_saidas', v_total_saidas,
      'saldo_atual', v_saldo_anterior + v_total_entradas - v_total_saidas,
      'saldo_base', v_saldo_base,
      'data_ancora', v_data_ancora
    ),
    'resultados', COALESCE(v_resultados, '[]'::jsonb)
  );
END;
$function$;

-- 2) RD-95: "?" (AjudaCampo) em filtros, KPIs e colunas do Extrato. Texto do banco, aditivo, idempotente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/financeiro/extrato', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('ge.extrato.filtro.conta', 'Filtros', 'Conta',
  'Escolha a conta bancária/caixa cujo extrato você quer ver, ou deixe "Todas as contas" para somar todas.',
  'Limita o extrato e os quatro cartões de saldo a uma conta só — útil para conferir o saldo de cada banco separadamente.',
  'Selecione "Caixa" para ver só as entradas e saídas em dinheiro.',
  'Comparar o saldo de uma conta com os cartões enquanto o filtro está em "Todas": os cartões seguem o filtro escolhido.', 1),
 ('ge.extrato.filtro.data_inicio', 'Filtros', 'De (data inicial)',
  'A data a partir da qual os lançamentos entram no extrato (pelo dia em que foram pagos/recebidos).',
  'Define o começo do período. O cartão "Saldo inicial do período" mostra quanto havia nas contas um instante antes desta data.',
  'Para o mês de maio, coloque 01/05.',
  'Confundir com a data de vencimento: o extrato usa a data do pagamento/recebimento, não a do vencimento.', 2),
 ('ge.extrato.filtro.data_fim', 'Filtros', 'Até (data final)',
  'A data até a qual os lançamentos entram no extrato (inclusive).',
  'Define o fim do período. O cartão "Saldo final do período" mostra o saldo das contas ao fim deste dia.',
  'Para o mês de maio, coloque 31/05.',
  'Deixar a data final antes da inicial: o período fica vazio e nenhum lançamento aparece.', 3),
 ('ge.extrato.filtro.tipo', 'Filtros', 'Tipo (entradas/saídas)',
  'Escolha ver todos os lançamentos, só entradas (recebimentos) ou só saídas (pagamentos).',
  'Ajuda a focar a conferência — por exemplo, revisar apenas o que saiu no período.',
  'Selecione "Só saídas" para listar apenas os pagamentos.',
  'Achar que o filtro muda os cartões de saldo: ele filtra só a lista; os quatro cartões seguem o período/conta inteiros.', 4),
 ('ge.extrato.filtro.busca', 'Filtros', 'Buscar',
  'Digite parte da descrição, do nome da pessoa (cliente/fornecedor) ou da categoria para filtrar a lista.',
  'Encontra um lançamento específico sem rolar a página inteira.',
  'Digite "energia" para ver só as contas de luz.',
  'Esperar que a busca procure por valor em reais: ela procura por texto (descrição, pessoa, categoria).', 5),
 ('ge.extrato.kpi.saldo_inicial', 'Saldos', 'Saldo inicial do período',
  'Nada a preencher: é o saldo das contas um instante antes da data inicial do filtro (abertura + tudo que entrou e saiu antes).',
  'É o ponto de partida da conferência: saldo inicial + entradas − saídas = saldo final. Com os quatro cartões você confere o extrato de cabo a rabo.',
  'Se as contas tinham R$ 1.483.132,42 na virada do dia anterior ao período, é esse o valor mostrado.',
  'Confundir com o saldo de abertura da conta: este é o saldo no começo do PERÍODO escolhido, não a abertura histórica.', 6),
 ('ge.extrato.kpi.entradas', 'Saldos', 'Entradas (período)',
  'Nada a preencher: é a soma, em reais, de tudo que foi recebido dentro do período filtrado.',
  'Mostra quanto entrou no caixa no período. Somada ao saldo inicial e subtraídas as saídas, dá o saldo final.',
  'Se houve R$ 831.220,00 de recebimentos no mês, é esse o valor.',
  'Contar títulos ainda não recebidos: só entram os já recebidos/pagos dentro do período.', 7),
 ('ge.extrato.kpi.saidas', 'Saldos', 'Saídas (período)',
  'Nada a preencher: é a soma, em reais, de tudo que foi pago dentro do período filtrado.',
  'Mostra quanto saiu do caixa no período. Subtraída do saldo inicial somado às entradas, dá o saldo final.',
  'Se houve R$ 1.163.903,34 de pagamentos no mês, é esse o valor.',
  'Contar contas ainda não pagas: só entram as já pagas dentro do período.', 8),
 ('ge.extrato.kpi.saldo_final', 'Saldos', 'Saldo final do período',
  'Nada a preencher: é o saldo das contas ao fim do período = saldo inicial + entradas − saídas.',
  'É o resultado da conferência. Se a conta não fecha, algum lançamento está com data ou valor errado.',
  'R$ 1.483.132,42 + R$ 831.220,00 − R$ 1.163.903,34 = R$ 1.150.449,08.',
  'Esperar que seja igual ao saldo do banco hoje: aqui é o saldo ao fim do PERÍODO filtrado, não a data de hoje (a menos que o período vá até hoje).', 9),
 ('ge.extrato.col.data', 'Colunas', 'Data',
  'Nada a preencher: é a data em que o lançamento foi pago (saída) ou recebido (entrada).',
  'Ordena o extrato no tempo e é a data que posiciona cada lançamento dentro do período.',
  '15/05/2026.',
  'Procurar pela data de vencimento: a coluna mostra a data do pagamento/recebimento.', 10),
 ('ge.extrato.col.descricao', 'Colunas', 'Descrição',
  'Nada a preencher: é o texto do lançamento (histórico) mais, quando houver, a parcela (ex.: "parcela 2/12").',
  'Identifica rapidamente a que se refere cada movimento.',
  '"Aluguel maio — parcela 5/12".',
  'Achar que o selo de parcela muda o valor: ele só informa qual parcela do parcelamento é aquela linha.', 11),
 ('ge.extrato.col.categoria', 'Colunas', 'Categoria',
  'Nada a preencher: é a categoria classificada no lançamento. Quando não há categoria, a coluna mostra a natureza (Receita/Despesa).',
  'Agrupa visualmente os movimentos por tipo de gasto/receita para leitura rápida.',
  '"Folha de pagamento", "Energia", ou — sem categoria — "Despesa".',
  'Esperar categoria em todo lançamento: recebimentos muitas vezes não têm categoria e aparecem como "Receita".', 12),
 ('ge.extrato.col.pessoa', 'Colunas', 'Pessoa',
  'Nada a preencher: é o cliente (nas entradas) ou o fornecedor (nas saídas) do lançamento.',
  'Mostra com quem foi a movimentação.',
  '"Supermercado Modelo Ltda".',
  'Confundir pessoa com categoria: pessoa é com quem foi a transação; categoria é o tipo do gasto/receita.', 13),
 ('ge.extrato.col.valor', 'Colunas', 'Valor',
  'Nada a preencher: é o valor do lançamento, com sinal — "+" para entrada e "−" para saída.',
  'Mostra o impacto de cada movimento no caixa. A soma das linhas do período bate com entradas − saídas.',
  '− R$ 2.300,00 (um pagamento); + R$ 5.000,00 (um recebimento).',
  'Somar ignorando o sinal: saídas reduzem o saldo (vêm com "−").', 14),
 ('ge.extrato.col.saldo', 'Colunas', 'Saldo',
  'Nada a preencher: é o saldo acumulado linha a linha, começando no saldo inicial do período.',
  'Permite ver como o saldo caminhou ao longo do período, lançamento a lançamento.',
  'Após um pagamento de R$ 2.300,00, o saldo da linha cai R$ 2.300,00 em relação à linha anterior.',
  'Ler o saldo da última linha como "saldo de hoje": ele é o saldo ao fim do período filtrado.', 15),
 ('ge.extrato.col.status', 'Colunas', 'Status',
  'Nada a preencher: é a situação do lançamento (pago, recebido, aberto).',
  'No extrato aparecem os já liquidados; o status confirma que o movimento de fato ocorreu.',
  '"pago" para uma despesa quitada.',
  'Esperar ver títulos "em aberto": o extrato lista só o que foi efetivamente pago/recebido no período.', 16)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- 3) RD-98 p3: origem do dado da tela (views/RPCs que ela consome).
UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_banco_contas']::text[],
       rpcs_chamadas   = ARRAY['fn_ge_extrato_conta','fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[]
 WHERE rota = '/dashboard/financeiro/extrato';
