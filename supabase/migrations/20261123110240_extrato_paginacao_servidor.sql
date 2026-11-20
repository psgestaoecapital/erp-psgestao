-- Extrato Conta Corrente (/dashboard/financeiro/extrato) — paginação e filtro no SERVIDOR.
--
-- PROBLEMA (RD-38, provado na DEMO Comércio-GE b0700000-...-0004, janela de 30 dias):
--   fn_ge_extrato_conta executa em ~373 ms no banco, MAS devolve TODAS as linhas num só JSON:
--   11.110 linhas = 4.122 kB de payload. A tela pagina 50 por vez no cliente, porém BAIXA os 4 MB
--   inteiros a cada carga. Em conexão real isso estoura o tempo da requisição (role `authenticated`
--   tem statement_timeout=8s) e a tela mostra "Não foi possível carregar o extrato — a conexão
--   demorou ou caiu". Qualquer empresa com volume alto no período bate no mesmo muro.
--
-- CORREÇÃO (aditiva, sem tocar dado de cliente):
--   fn_ge_extrato_conta ganha parâmetros OPCIONAIS p_tipo / p_busca / p_limit / p_offset e devolve
--   `total_linhas`. O saldo acumulado continua calculado sobre o período INTEIRO (janela correta),
--   só então aplica tipo/busca e devolve a PÁGINA pedida. Totalizadores (saldo_anterior, entradas,
--   saídas, saldo_atual) permanecem do período cheio — idênticos aos de hoje.
--   Prova: totalizadores idênticos ao da função antiga; total_linhas=11.110; página 1 e página 2
--   byte-a-byte iguais às 50 primeiras e 51–100 do resultado antigo; payload da página cai de
--   4.122 kB para 19 kB; filtro entradas(4401)+saídas(6709)=11110; p_limit NULL devolve tudo (export).
--
-- Compatibilidade: a chamada antiga de 4 args (p_company_id, p_conta_id, p_data_inicio, p_data_fim)
--   continua resolvendo pelos defaults. Removo a assinatura de 4 args para não deixar DUAS overloads
--   (PostgREST ficaria ambíguo ao receber os 4 nomes).

DROP FUNCTION IF EXISTS public.fn_ge_extrato_conta(uuid, uuid, date, date);
-- limpeza do helper de validação RD-38 (nunca foi referenciado por nada em produção)
DROP FUNCTION IF EXISTS public.fn_ge_extrato_conta_v2test(uuid, uuid, date, date, text, text, int, int);

CREATE OR REPLACE FUNCTION public.fn_ge_extrato_conta(
  p_company_id uuid,
  p_conta_id uuid DEFAULT NULL::uuid,
  p_data_inicio date DEFAULT NULL::date,
  p_data_fim date DEFAULT NULL::date,
  p_tipo text DEFAULT 'todos'::text,
  p_busca text DEFAULT NULL::text,
  p_limit int DEFAULT NULL::int,
  p_offset int DEFAULT 0
)
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
  v_conta_nome text := NULL;
  v_resultados jsonb;
  v_total_linhas int := 0;
  -- filtros/paginação (saneados no servidor)
  v_tipo text := lower(COALESCE(p_tipo, 'todos'));
  v_busca text := NULLIF(btrim(COALESCE(p_busca, '')), '');
  v_limit int := CASE WHEN p_limit IS NULL OR p_limit <= 0 THEN NULL ELSE LEAST(p_limit, 5000) END;
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF NOT EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  -- Conta selecionada: resolve o NOME (vínculo de erp_pagar.conta_bancaria é por nome) e já valida
  -- que a conta pertence à empresa. p_conta_id NULL = empresa inteira (v_conta_nome permanece NULL).
  IF p_conta_id IS NOT NULL THEN
    SELECT nome INTO v_conta_nome
      FROM erp_banco_contas
      WHERE id = p_conta_id AND company_id = p_company_id;
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
      WHERE company_id = p_company_id AND status IN ('recebido','pago') AND data_pagamento < v_data_inicio
        AND (p_conta_id IS NULL OR conta_bancaria_id = p_conta_id OR (conta_bancaria_id IS NULL AND conta_bancaria = v_conta_nome));
    SELECT v_saldo_base + v_c_inicio - COALESCE(SUM(COALESCE(valor_pago, valor)),0) INTO v_saldo_anterior
      FROM erp_pagar
      WHERE company_id = p_company_id AND status = 'pago' AND data_pagamento < v_data_inicio
        AND (p_conta_id IS NULL OR conta_bancaria = v_conta_nome);
  ELSE
    v_c_inicio :=
        (SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) FROM erp_receber
          WHERE company_id=p_company_id AND status IN ('recebido','pago') AND data_pagamento <= v_data_inicio - 1
            AND (p_conta_id IS NULL OR conta_bancaria_id = p_conta_id OR (conta_bancaria_id IS NULL AND conta_bancaria = v_conta_nome)))
      - (SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) FROM erp_pagar
          WHERE company_id=p_company_id AND status='pago' AND data_pagamento <= v_data_inicio - 1
            AND (p_conta_id IS NULL OR conta_bancaria = v_conta_nome));
    v_c_ancora :=
        (SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) FROM erp_receber
          WHERE company_id=p_company_id AND status IN ('recebido','pago') AND data_pagamento <= v_data_ancora
            AND (p_conta_id IS NULL OR conta_bancaria_id = p_conta_id OR (conta_bancaria_id IS NULL AND conta_bancaria = v_conta_nome)))
      - (SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) FROM erp_pagar
          WHERE company_id=p_company_id AND status='pago' AND data_pagamento <= v_data_ancora
            AND (p_conta_id IS NULL OR conta_bancaria = v_conta_nome));
    v_saldo_anterior := v_saldo_base + v_c_inicio - v_c_ancora;
  END IF;

  SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) INTO v_total_entradas
    FROM erp_receber
    WHERE company_id = p_company_id AND status IN ('recebido','pago')
      AND data_pagamento BETWEEN v_data_inicio AND v_data_fim
      AND (p_conta_id IS NULL OR conta_bancaria_id = p_conta_id OR (conta_bancaria_id IS NULL AND conta_bancaria = v_conta_nome));
  SELECT COALESCE(SUM(COALESCE(valor_pago, valor)),0) INTO v_total_saidas
    FROM erp_pagar
    WHERE company_id = p_company_id AND status = 'pago'
      AND data_pagamento BETWEEN v_data_inicio AND v_data_fim
      AND (p_conta_id IS NULL OR conta_bancaria = v_conta_nome);

  WITH movimentos AS (
    SELECT id, 'receita' AS tipo, descricao, cliente_nome AS nome_pessoa, categoria, numero_documento,
      forma_pagamento, status, parcela, COALESCE(valor_pago, valor) AS valor,
      data_pagamento AS data, COALESCE(valor_pago, valor) AS sinal
    FROM erp_receber
    WHERE company_id = p_company_id AND status IN ('recebido','pago')
      AND data_pagamento BETWEEN v_data_inicio AND v_data_fim
      AND COALESCE(valor_pago, valor) <> 0
      AND (p_conta_id IS NULL OR conta_bancaria_id = p_conta_id OR (conta_bancaria_id IS NULL AND conta_bancaria = v_conta_nome))
    UNION ALL
    SELECT id, 'despesa', descricao, fornecedor_nome, categoria, numero_documento,
      forma_pagamento, status, parcela, COALESCE(valor_pago, valor),
      data_pagamento, -COALESCE(valor_pago, valor)
    FROM erp_pagar
    WHERE company_id = p_company_id AND status = 'pago'
      AND data_pagamento BETWEEN v_data_inicio AND v_data_fim
      AND COALESCE(valor_pago, valor) <> 0
      AND (p_conta_id IS NULL OR conta_bancaria = v_conta_nome)
  ),
  com_saldo AS (
    -- saldo acumulado sobre o período INTEIRO (ordem cronológica), antes de filtrar.
    SELECT *, v_saldo_anterior + SUM(sinal) OVER (ORDER BY data, id ROWS UNBOUNDED PRECEDING) AS saldo_acumulado
    FROM movimentos
  ),
  filtrado AS (
    SELECT * FROM com_saldo
    WHERE (v_tipo <> 'entradas' OR sinal > 0)
      AND (v_tipo <> 'saidas'  OR sinal < 0)
      AND (v_busca IS NULL
           OR (COALESCE(descricao,'') || ' ' || COALESCE(nome_pessoa,'') || ' ' || COALESCE(categoria,'')) ILIKE '%' || v_busca || '%')
  ),
  ordenado AS (
    SELECT * FROM filtrado
    ORDER BY data DESC, id DESC
    OFFSET v_offset LIMIT v_limit
  )
  SELECT (SELECT count(*) FROM filtrado),
         jsonb_agg(row_to_json(a) ORDER BY a.data DESC, a.id DESC)
    INTO v_total_linhas, v_resultados
  FROM ordenado a;

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
    'total_linhas', v_total_linhas,
    'resultados', COALESCE(v_resultados, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ge_extrato_conta(uuid, uuid, date, date, text, text, int, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_extrato_conta(uuid, uuid, date, date, text, text, int, int) TO authenticated;
