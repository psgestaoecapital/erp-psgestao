-- Reconciliação RD-52 (conserto-main) — gilberto-esteira, 2026-11-04.
-- Esta migration foi aplicada em produção via MCP (apply_migration) e carimbada no ledger
-- como versão 20261104002141 (contrato_faturamento_antecipado_dia1), mas o arquivo nunca
-- foi commitado no repo. Resultado: `supabase db push --include-all` abortava com
-- "Remote migration versions not found in local migrations directory" (repair 20261104002141),
-- deixando o deploy-migrations VERMELHO e travando toda a esteira de migrations.
-- O corpo abaixo é EXATAMENTE o que já rodou (conferido no ledger e na definição viva da
-- função em produção — RD-38). CREATE OR REPLACE é idempotente; como a versão já consta no
-- ledger, o db push a reconhece como aplicada e apenas reconcilia repo×ledger (nenhuma
-- mudança de lógica nem de dado de cliente). Nome do arquivo = versão do ledger (RD-52).
CREATE OR REPLACE FUNCTION public.fn_contrato_processar_lote_diario(p_data_referencia date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
-- Gera os títulos do mês inteiro já no dia 1º (antecedência para emissão de boletos).
-- Roda todo dia: nos demais dias completa o que faltar (idempotente por contrato/mês).
DECLARE
  v_contrato record;
  v_resultado jsonb;
  v_total_processado int := 0;
  v_total_sucesso int := 0;
  v_total_erro int := 0;
  v_total_idempotente int := 0;
  v_erros jsonb := '[]'::jsonb;
  v_dia_atual int;
  v_mes_ref date;
BEGIN
  v_dia_atual := EXTRACT(DAY FROM p_data_referencia)::int;
  v_mes_ref := date_trunc('month', p_data_referencia)::date;

  FOR v_contrato IN
    SELECT id, numero, nome, dia_vencimento, periodicidade, natureza
    FROM erp_contratos
    WHERE status = 'ativo'
      AND data_inicio <= v_mes_ref
      AND (data_fim IS NULL OR data_fim >= v_mes_ref)
      AND CASE periodicidade
        WHEN 'mensal' THEN true
        WHEN 'bimestral' THEN EXTRACT(MONTH FROM p_data_referencia)::int % 2 = EXTRACT(MONTH FROM data_inicio)::int % 2
        WHEN 'trimestral' THEN EXTRACT(MONTH FROM p_data_referencia)::int % 3 = EXTRACT(MONTH FROM data_inicio)::int % 3
        WHEN 'semestral' THEN EXTRACT(MONTH FROM p_data_referencia)::int % 6 = EXTRACT(MONTH FROM data_inicio)::int % 6
        WHEN 'anual' THEN EXTRACT(MONTH FROM p_data_referencia)::int = EXTRACT(MONTH FROM data_inicio)::int
        ELSE true
      END
  LOOP
    v_total_processado := v_total_processado + 1;

    BEGIN
      IF v_contrato.natureza = 'despesa' THEN
        v_resultado := fn_contrato_gerar_pagar(v_contrato.id, v_mes_ref);
      ELSE
        v_resultado := fn_contrato_gerar_receber(v_contrato.id, v_mes_ref);
      END IF;

      IF (v_resultado->>'success')::boolean THEN
        v_total_sucesso := v_total_sucesso + 1;
      ELSIF (v_resultado->>'idempotente')::boolean THEN
        v_total_idempotente := v_total_idempotente + 1;
      ELSE
        v_total_erro := v_total_erro + 1;
        v_erros := v_erros || jsonb_build_object(
          'contrato_id', v_contrato.id, 'numero', v_contrato.numero, 'erro', v_resultado->>'error');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_total_erro := v_total_erro + 1;
      v_erros := v_erros || jsonb_build_object(
        'contrato_id', v_contrato.id, 'numero', v_contrato.numero, 'erro', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true, 'data_referencia', p_data_referencia, 'mes_referencia', v_mes_ref,
    'dia_atual', v_dia_atual, 'total_processado', v_total_processado,
    'total_sucesso', v_total_sucesso, 'total_idempotente', v_total_idempotente,
    'total_erro', v_total_erro, 'erros', v_erros, 'executado_em', now());
END;
$function$;
