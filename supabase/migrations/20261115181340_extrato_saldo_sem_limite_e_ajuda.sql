-- PDCA GE · /dashboard/financeiro/extrato
-- BUG 2 (correção de saldo — dinheiro): fn_ge_extrato_conta tinha LIMIT 500 na CTE de movimentos ANTES
-- da janela de saldo. Em período com >500 baixas a tabela era SILENCIOSAMENTE truncada e o
-- saldo_acumulado era calculado só sobre o conjunto cortado, enquanto os 4 totalizadores somavam o
-- conjunto completo — tabela e cartões DIVERGIAM e o saldo final da tabela ficava errado.
-- Correção: remove o LIMIT 500 → o saldo acumulado é calculado sobre TODOS os movimentos do período
-- (bounded por data_pagamento BETWEEN início E fim), fechando com os totalizadores. A exibição é
-- paginada no front (seletor "Por página" + Anterior/Próxima), sem cortar o acumulado.
-- Único ponto alterado vs. a versão viva: a linha "LIMIT 500" sai da CTE movimentos. Demais lógicas
-- (guarda de empresa, gate de plano, saldo-âncora, totalizadores, ordenação) permanecem idênticas.
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
  PERFORM public.fn__guarda_empresa(p_company_id);
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
    -- abertura + (recebidos antes do início) − (pagos antes do início).
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

-- GAP 4 (RD-95): "?" das ações da tela que ainda não tinham ajuda (período rápido, por página,
-- paginação, conciliar, exportar CSV, abrir registro, importar OFX).
-- Aditivo: só INSERT de texto (ON CONFLICT DO NOTHING).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Financeiro · Extrato', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/financeiro/extrato', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('ge.extrato.acao.periodo_rapido', 'Período rápido', 'Botões de atalho que ajustam as datas De/Até de uma vez: Hoje, 7, 30 ou 90 dias, mês atual ou mês passado.', 'Mostra o extrato do intervalo escolhido sem precisar digitar as datas.', 'Clicar em "Mês passado" para fechar a conciliação do mês anterior.', 'Esquecer que o atalho trocou as datas e achar que o saldo "sumiu": confira o período no topo.', 40),
 ('ge.extrato.filtro.por_pagina', 'Por página', 'Quantas linhas aparecem por página da tabela (50, 100 ou 200). Não muda os totais, só a exibição.', 'Facilita navegar períodos longos sem rolar demais.', '50 para o dia a dia; 200 para revisar um mês inteiro de uma vez.', 'Achar que faltam lançamentos: eles estão nas próximas páginas, não sumiram.', 41),
 ('ge.extrato.acao.paginacao', 'Páginas', 'Navega entre as páginas da tabela (Anterior / Próxima). Os totais e o saldo somam o período inteiro, não só a página.', 'Permite ver todos os movimentos do período sem carregar tudo de uma vez na tela.', 'Avançar para ver os lançamentos mais antigos do período.', 'Comparar o saldo da última linha da página com o saldo final do período: o saldo final está no cartão, não na página.', 42),
 ('ge.extrato.acao.conciliar', 'Conciliar', 'Abre a Conciliação para importar o extrato do banco (OFX) e casar com os lançamentos.', 'Confere se o que está no sistema bate com o extrato real do banco.', 'Importar o OFX do mês e marcar os pagamentos que já caíram.', 'Lançar de novo um pagamento que já existe em vez de conciliar: a conta fica em dobro.', 43),
 ('ge.extrato.acao.exportar_csv', 'Exportar CSV', 'Baixa as linhas filtradas do extrato num arquivo CSV (abre no Excel/Planilhas).', 'Leva o extrato para fora do sistema para análise ou envio ao contador.', 'Exportar o período e abrir no Excel para somar por categoria.', 'Exportar sem conferir o filtro: o arquivo sai só com o que está filtrado na tela.', 44),
 ('ge.extrato.acao.abrir_registro', 'Abrir registro', 'O lápis (✎) de cada linha abre a conta a pagar ou a receber que gerou aquele movimento.', 'Leva ao lançamento original para ver detalhes, anexos ou corrigir.', 'Clicar no ✎ de uma despesa para ver a nota fiscal anexada.', 'Procurar o lançamento à mão na outra tela em vez de abrir pelo ✎.', 45),
 ('ge.extrato.acao.importar_ofx', 'Importar OFX', 'Abre a Conciliação para subir o arquivo OFX do banco quando ainda não há movimentos no período.', 'Traz os lançamentos do extrato bancário para começar a conciliar.', 'Importar o OFX do mês para popular o extrato de uma empresa nova.', 'Tentar importar um PDF do banco: o formato aceito é o OFX.', 46)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;

-- ACL explícita da função SECURITY DEFINER recriada (check_fn_guards · revoke_anon):
-- o CREATE OR REPLACE reescreve a função, então reafirmamos a ACL viva
-- (authenticated/service_role; nunca anon/PUBLIC).
REVOKE ALL ON FUNCTION public.fn_ge_extrato_conta(uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_extrato_conta(uuid, uuid, date, date) TO authenticated, service_role;
