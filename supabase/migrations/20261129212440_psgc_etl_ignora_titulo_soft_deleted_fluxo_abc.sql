-- fn_psgc_recalcular_fluxo + fn_psgc_recalcular_abc: passam a IGNORAR títulos soft-deletados
-- (deleted_at IS NOT NULL) nos ramos erp_receber/erp_pagar.
--
-- CAUSA-RAIZ (auditor_pdca_2, PDCA GE · DRE/pipeline · 26/11 · provado no dado — RD-38):
-- os jobs recalcular_fluxo (571) e recalcular_abc (452) ABANDONAVAM EM SILÊNCIO por "numeric field
-- overflow" (status=erro, 3/3 tentativas). Prova no dado: TODOS os títulos de valor absurdo da DEMO GE
-- (≥ R$ 100 bilhões, somando dezenas de TRILHÕES) estão com deleted_at PREENCHIDO (soft-deletados:
-- 556 receber 'cancelado' + 367 'pago' + 1 'vencido' + 367 pagar 'pago'). Mas estes dois ETLs NÃO
-- filtravam deleted_at nos ramos erp_receber/erp_pagar, então somavam o lixo morto e estouravam as
-- colunas de dinheiro numeric(15,2) (fornecedor ABC chegava a R$ 73,4 tri; soma diária do fluxo a
-- R$ 80 tri). Com o filtro, os mesmos agregados ficam SÃOS (fluxo/dia ≤ ~R$ 1 mil; fornecedor ≤
-- ~R$ 211 mil) e os jobs concluem → o read-model volta a atualizar em vez de ficar preso no valor velho.
--
-- CORREÇÃO (genérica e CORRETA p/ TODA empresa, não é só-demo): título soft-deletado NUNCA deve entrar
-- em fluxo de caixa realizado nem em curva ABC. Adiciona "AND <alias>.deleted_at IS NULL" aos ramos
-- erp_receber/erp_pagar de ambas as funções. ZERO mudança de dado de cliente, sem DDL de estrutura.
-- fn_psgc_recalcular_dre_mes já filtra deleted_at (seus 248 erros eram ANTIGOS, de antes do filtro) —
-- por isso só re-enfileiramos os jobs dele. erp_lancamentos não tem coluna deleted_at (ramos IF ficam
-- como estão). Ao fim, re-enfileira os jobs em erro (fluxo/abc/dre_mes) para os read-models de dinheiro
-- (fluxo/ABC/DRE) voltarem ao estado correto.

CREATE OR REPLACE FUNCTION public.fn_psgc_recalcular_fluxo(p_company_id uuid, p_ano integer, p_mes integer DEFAULT NULL::integer)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_data_inicio date;
  v_data_fim date;
  v_inseridos bigint := 0;
  v_tem_lancamentos boolean;
BEGIN
  IF p_mes IS NULL THEN
    v_data_inicio := make_date(p_ano, 1, 1);
    v_data_fim := make_date(p_ano, 12, 31);
  ELSE
    v_data_inicio := make_date(p_ano, p_mes, 1);
    v_data_fim := (v_data_inicio + interval '1 month - 1 day')::date;
  END IF;

  v_tem_lancamentos := EXISTS(SELECT 1 FROM erp_lancamentos WHERE company_id=p_company_id AND fn_parse_data_text(data_pagamento) BETWEEN v_data_inicio AND v_data_fim LIMIT 1);

  DELETE FROM psgc_fluxo_realizado
  WHERE company_id = p_company_id AND data BETWEEN v_data_inicio AND v_data_fim;

  IF v_tem_lancamentos THEN
    INSERT INTO psgc_fluxo_realizado (company_id, data, entradas, saidas, qtd_entradas, qtd_saidas)
    SELECT p_company_id, d::date,
      COALESCE(SUM(ent.v), 0), COALESCE(SUM(sai.v), 0),
      COALESCE(SUM(ent.q), 0)::int, COALESCE(SUM(sai.q), 0)::int
    FROM generate_series(v_data_inicio, v_data_fim, '1 day'::interval) d
    LEFT JOIN LATERAL (
      SELECT SUM(ABS(valor_documento)) as v, COUNT(*) as q FROM erp_lancamentos l
      WHERE l.company_id = p_company_id AND LOWER(l.tipo) IN ('receber','receita')
        AND fn_parse_data_text(l.data_pagamento) = d::date
        AND (l.status IS NULL OR l.status NOT IN ('cancelado'))
    ) ent ON true
    LEFT JOIN LATERAL (
      SELECT SUM(ABS(valor_documento)) as v, COUNT(*) as q FROM erp_lancamentos l
      WHERE l.company_id = p_company_id AND LOWER(l.tipo) IN ('pagar','despesa')
        AND fn_parse_data_text(l.data_pagamento) = d::date
        AND (l.status IS NULL OR l.status NOT IN ('cancelado'))
    ) sai ON true
    GROUP BY d;
  ELSE
    -- usa COALESCE(NULLIF(valor_pago,0), valor) — algumas origens zeram valor_pago em vez de deixar NULL
    INSERT INTO psgc_fluxo_realizado (company_id, data, entradas, saidas, qtd_entradas, qtd_saidas)
    SELECT p_company_id, d::date,
      COALESCE(SUM(ent.v), 0), COALESCE(SUM(sai.v), 0),
      COALESCE(SUM(ent.q), 0)::int, COALESCE(SUM(sai.q), 0)::int
    FROM generate_series(v_data_inicio, v_data_fim, '1 day'::interval) d
    LEFT JOIN LATERAL (
      SELECT SUM(COALESCE(NULLIF(valor_pago, 0), valor)) as v, COUNT(*) as q
      FROM erp_receber r
      WHERE r.company_id = p_company_id AND r.data_pagamento = d::date
        AND r.deleted_at IS NULL
        AND COALESCE(NULLIF(valor_pago, 0), valor) > 0
    ) ent ON true
    LEFT JOIN LATERAL (
      SELECT SUM(COALESCE(NULLIF(valor_pago, 0), valor)) as v, COUNT(*) as q
      FROM erp_pagar p
      WHERE p.company_id = p_company_id AND p.data_pagamento = d::date
        AND p.deleted_at IS NULL
        AND COALESCE(NULLIF(valor_pago, 0), valor) > 0
    ) sai ON true
    GROUP BY d;
  END IF;

  GET DIAGNOSTICS v_inseridos = ROW_COUNT;
  RETURN v_inseridos;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_psgc_recalcular_abc(p_company_id uuid, p_ano integer, p_mes integer DEFAULT NULL::integer)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_data_inicio date;
  v_data_fim date;
  v_inseridos bigint := 0;
  v_tem_lancamentos boolean;
BEGIN
  IF p_mes IS NULL THEN
    v_data_inicio := make_date(p_ano, 1, 1);
    v_data_fim := make_date(p_ano, 12, 31);
  ELSE
    v_data_inicio := make_date(p_ano, p_mes, 1);
    v_data_fim := (v_data_inicio + interval '1 month - 1 day')::date;
  END IF;

  v_tem_lancamentos := EXISTS(
    SELECT 1 FROM erp_lancamentos
    WHERE company_id=p_company_id
      AND fn_parse_data_text(data_emissao) BETWEEN v_data_inicio AND v_data_fim
    LIMIT 1
  );

  -- ABC Clientes
  DELETE FROM psgc_abc WHERE company_id = p_company_id AND tipo = 'cliente'
    AND ano = p_ano AND COALESCE(mes, 0) = COALESCE(p_mes, 0);

  IF v_tem_lancamentos THEN
    -- erp_lancamentos: usa nome_pessoa quando tipo é receber
    WITH receber_agg AS (
      SELECT
        UPPER(TRIM(COALESCE(l.cliente_id::text, l.nome_pessoa, l.descricao, 'SEM_ID'))) as entidade_id,
        MAX(COALESCE(l.nome_pessoa, l.descricao, 'Cliente sem nome')) as entidade_nome,
        SUM(ABS(l.valor_documento)) as valor_total,
        COUNT(*) as qtd
      FROM erp_lancamentos l
      WHERE l.company_id = p_company_id
        AND LOWER(l.tipo) IN ('receber','receita')
        AND l.data_emissao IS NOT NULL
        AND fn_parse_data_text(l.data_emissao) BETWEEN v_data_inicio AND v_data_fim
        AND (l.status IS NULL OR l.status != 'cancelado')
      GROUP BY 1
    ),
    total AS (SELECT SUM(valor_total) as grand_total FROM receber_agg),
    ranked AS (
      SELECT ra.*,
        (valor_total / NULLIF(t.grand_total, 0) * 100)::numeric(5,2) as pct,
        (SUM(valor_total) OVER (ORDER BY valor_total DESC) / NULLIF(t.grand_total, 0) * 100)::numeric(5,2) as pct_acum
      FROM receber_agg ra CROSS JOIN total t
    )
    INSERT INTO psgc_abc (company_id, tipo, ano, mes, entidade_id, entidade_nome, valor_total, qtd_transacoes, participacao_pct, participacao_acumulada_pct, classe_abc)
    SELECT p_company_id, 'cliente', p_ano, p_mes, entidade_id, entidade_nome, valor_total, qtd, pct, pct_acum,
      CASE WHEN pct_acum <= 80 THEN 'A' WHEN pct_acum <= 95 THEN 'B' ELSE 'C' END
    FROM ranked WHERE valor_total > 0
    ON CONFLICT (company_id, tipo, ano, COALESCE(mes, 0), entidade_id) DO UPDATE SET
      entidade_nome = EXCLUDED.entidade_nome, valor_total = EXCLUDED.valor_total,
      qtd_transacoes = EXCLUDED.qtd_transacoes, participacao_pct = EXCLUDED.participacao_pct,
      participacao_acumulada_pct = EXCLUDED.participacao_acumulada_pct, classe_abc = EXCLUDED.classe_abc;
  ELSE
    WITH receber_agg AS (
      SELECT
        UPPER(TRIM(COALESCE(r.cliente_id::text, r.cliente_nome, 'SEM_ID'))) as entidade_id,
        MAX(COALESCE(r.cliente_nome, 'Cliente sem nome')) as entidade_nome,
        SUM(r.valor) as valor_total, COUNT(*) as qtd
      FROM erp_receber r
      WHERE r.company_id = p_company_id
        AND r.data_emissao IS NOT NULL
        AND r.data_emissao BETWEEN v_data_inicio AND v_data_fim
        AND r.deleted_at IS NULL
        AND (r.status IS NULL OR r.status != 'cancelado')
      GROUP BY 1
    ),
    total AS (SELECT SUM(valor_total) as grand_total FROM receber_agg),
    ranked AS (
      SELECT ra.*,
        (valor_total / NULLIF(t.grand_total, 0) * 100)::numeric(5,2) as pct,
        (SUM(valor_total) OVER (ORDER BY valor_total DESC) / NULLIF(t.grand_total, 0) * 100)::numeric(5,2) as pct_acum
      FROM receber_agg ra CROSS JOIN total t
    )
    INSERT INTO psgc_abc (company_id, tipo, ano, mes, entidade_id, entidade_nome, valor_total, qtd_transacoes, participacao_pct, participacao_acumulada_pct, classe_abc)
    SELECT p_company_id, 'cliente', p_ano, p_mes, entidade_id, entidade_nome, valor_total, qtd, pct, pct_acum,
      CASE WHEN pct_acum <= 80 THEN 'A' WHEN pct_acum <= 95 THEN 'B' ELSE 'C' END
    FROM ranked WHERE valor_total > 0
    ON CONFLICT (company_id, tipo, ano, COALESCE(mes, 0), entidade_id) DO UPDATE SET
      entidade_nome = EXCLUDED.entidade_nome, valor_total = EXCLUDED.valor_total,
      qtd_transacoes = EXCLUDED.qtd_transacoes, participacao_pct = EXCLUDED.participacao_pct,
      participacao_acumulada_pct = EXCLUDED.participacao_acumulada_pct, classe_abc = EXCLUDED.classe_abc;
  END IF;

  GET DIAGNOSTICS v_inseridos = ROW_COUNT;

  -- ABC Fornecedores
  DELETE FROM psgc_abc WHERE company_id = p_company_id AND tipo = 'fornecedor'
    AND ano = p_ano AND COALESCE(mes, 0) = COALESCE(p_mes, 0);

  IF v_tem_lancamentos THEN
    WITH pagar_agg AS (
      SELECT
        UPPER(TRIM(COALESCE(l.fornecedor_id::text, l.nome_pessoa, l.descricao, 'SEM_ID'))) as entidade_id,
        MAX(COALESCE(l.nome_pessoa, l.descricao, 'Fornecedor sem nome')) as entidade_nome,
        SUM(ABS(l.valor_documento)) as valor_total, COUNT(*) as qtd
      FROM erp_lancamentos l
      WHERE l.company_id = p_company_id
        AND LOWER(l.tipo) IN ('pagar','despesa')
        AND l.data_emissao IS NOT NULL
        AND fn_parse_data_text(l.data_emissao) BETWEEN v_data_inicio AND v_data_fim
        AND (l.status IS NULL OR l.status != 'cancelado')
      GROUP BY 1
    ),
    total AS (SELECT SUM(valor_total) as grand_total FROM pagar_agg),
    ranked AS (
      SELECT pa.*,
        (valor_total / NULLIF(t.grand_total, 0) * 100)::numeric(5,2) as pct,
        (SUM(valor_total) OVER (ORDER BY valor_total DESC) / NULLIF(t.grand_total, 0) * 100)::numeric(5,2) as pct_acum
      FROM pagar_agg pa CROSS JOIN total t
    )
    INSERT INTO psgc_abc (company_id, tipo, ano, mes, entidade_id, entidade_nome, valor_total, qtd_transacoes, participacao_pct, participacao_acumulada_pct, classe_abc)
    SELECT p_company_id, 'fornecedor', p_ano, p_mes, entidade_id, entidade_nome, valor_total, qtd, pct, pct_acum,
      CASE WHEN pct_acum <= 80 THEN 'A' WHEN pct_acum <= 95 THEN 'B' ELSE 'C' END
    FROM ranked WHERE valor_total > 0
    ON CONFLICT (company_id, tipo, ano, COALESCE(mes, 0), entidade_id) DO UPDATE SET
      entidade_nome = EXCLUDED.entidade_nome, valor_total = EXCLUDED.valor_total,
      qtd_transacoes = EXCLUDED.qtd_transacoes, participacao_pct = EXCLUDED.participacao_pct,
      participacao_acumulada_pct = EXCLUDED.participacao_acumulada_pct, classe_abc = EXCLUDED.classe_abc;
  ELSE
    WITH pagar_agg AS (
      SELECT
        UPPER(TRIM(COALESCE(p.fornecedor_id::text, p.fornecedor_nome, 'SEM_ID'))) as entidade_id,
        MAX(COALESCE(p.fornecedor_nome, 'Fornecedor sem nome')) as entidade_nome,
        SUM(p.valor) as valor_total, COUNT(*) as qtd
      FROM erp_pagar p
      WHERE p.company_id = p_company_id
        AND p.data_emissao IS NOT NULL
        AND p.data_emissao BETWEEN v_data_inicio AND v_data_fim
        AND p.deleted_at IS NULL
        AND (p.status IS NULL OR p.status != 'cancelado')
      GROUP BY 1
    ),
    total AS (SELECT SUM(valor_total) as grand_total FROM pagar_agg),
    ranked AS (
      SELECT pa.*,
        (valor_total / NULLIF(t.grand_total, 0) * 100)::numeric(5,2) as pct,
        (SUM(valor_total) OVER (ORDER BY valor_total DESC) / NULLIF(t.grand_total, 0) * 100)::numeric(5,2) as pct_acum
      FROM pagar_agg pa CROSS JOIN total t
    )
    INSERT INTO psgc_abc (company_id, tipo, ano, mes, entidade_id, entidade_nome, valor_total, qtd_transacoes, participacao_pct, participacao_acumulada_pct, classe_abc)
    SELECT p_company_id, 'fornecedor', p_ano, p_mes, entidade_id, entidade_nome, valor_total, qtd, pct, pct_acum,
      CASE WHEN pct_acum <= 80 THEN 'A' WHEN pct_acum <= 95 THEN 'B' ELSE 'C' END
    FROM ranked WHERE valor_total > 0
    ON CONFLICT (company_id, tipo, ano, COALESCE(mes, 0), entidade_id) DO UPDATE SET
      entidade_nome = EXCLUDED.entidade_nome, valor_total = EXCLUDED.valor_total,
      qtd_transacoes = EXCLUDED.qtd_transacoes, participacao_pct = EXCLUDED.participacao_pct,
      participacao_acumulada_pct = EXCLUDED.participacao_acumulada_pct, classe_abc = EXCLUDED.classe_abc;
  END IF;

  RETURN v_inseridos;
END;
$function$;

-- Reprocessa (re-enfileira) os jobs de dinheiro que estavam em erro, para os read-models
-- (fluxo/ABC/DRE) voltarem ao estado correto com as funções corrigidas.
-- Idempotente: só toca jobs status='erro' destes três tipos.
UPDATE public.psgc_job_queue
   SET status = 'pendente', tentativas = 0, erro_mensagem = NULL, completed_at = NULL, started_at = NULL
 WHERE status = 'erro' AND tipo IN ('recalcular_fluxo','recalcular_abc','recalcular_dre_mes');
