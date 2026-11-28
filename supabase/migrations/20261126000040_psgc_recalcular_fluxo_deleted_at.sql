-- fn_psgc_recalcular_fluxo: ignorar títulos soft-deletados no fluxo REALIZADO (núcleo GE).
--
-- RAIZ (RD-38, provado no dado em produção, DEMO GE b0700000-...-0004, 2026):
--   O ramo ELSE (usado quando a empresa não tem erp_lancamentos) somava erp_receber/erp_pagar
--   SEM filtrar deleted_at. Na DEMO GE havia 835 títulos soft-deletados com data_pagamento
--   (R$ 281.800.000.110.020,46 fantasma) contra apenas 2 vivos (R$ 1.494,00). As funções-irmãs
--   fn_fluxo_caixa_diario e fn_caixa_grupo_mes JÁ filtram deleted_at IS NULL; esta ficou para trás,
--   e o Hub GE / fluxo projetado herdavam o número envenenado.
--
-- CORREÇÃO (mínima, espelha as irmãs):
--   Ramo ELSE: AND r.deleted_at IS NULL (receber) e AND p.deleted_at IS NULL (pagar).
--   Ramo erp_lancamentos: INALTERADO — erp_lancamentos NÃO possui coluna deleted_at
--   (confirmado em information_schema); o filtro de status 'cancelado' continua como está.
--   Checado em produção: 0 títulos status='cancelado' vivos (deleted_at IS NULL) com data_pagamento
--   e valor>0 → deleted_at IS NULL já cobre todo o vazamento; nenhum filtro de status adicionado.
--
-- RD-100: comentário citava nome de sistema de terceiros; trocado por "ref. mercado".
--
-- Aditiva: só CREATE OR REPLACE de função STABLE de leitura+recálculo; não altera estrutura
-- nem dado de cliente. O recálculo final é guardado para empresa DEMO (is_demo) apenas.

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
    -- ref. mercado: usa COALESCE(NULLIF(valor_pago,0), valor) — alguns sistemas zeram valor_pago em vez de deixar NULL
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

-- Recálculo de limpeza SÓ-DEMO (guardado por is_demo): zera o fantasma de R$281 TRI na DEMO GE
-- para a jornada do Hub GE voltar a mostrar o realizado correto (R$ 1.494,00 de 2 títulos vivos).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM companies WHERE id = 'b0700000-0000-4000-a000-000000000004' AND is_demo IS TRUE) THEN
    PERFORM fn_psgc_recalcular_fluxo('b0700000-0000-4000-a000-000000000004', y)
    FROM generate_series(2024, 2026) AS y;
  END IF;
END $$;
