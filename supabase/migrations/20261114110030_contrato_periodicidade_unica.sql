-- P2 (CEO 12/11, teste real CTR-2026-0012): contrato de evento único (locação de 1 dia) chegou com
-- periodicidade "Todo mês". Falta a opção "Única (evento/avulso)". A UI passa a oferecê-la (gera 1
-- parcela, Até = De). No banco, o único ponto que RAMIFICA por periodicidade é o lote diário de
-- recorrência (fn_contrato_processar_lote_diario), cujo CASE tinha "ELSE true" — ou seja, uma
-- periodicidade desconhecida como 'unica' seria faturada TODO MÊS (fn_contrato_gerar_receber). Aqui o
-- lote passa a NÃO reprocessar o contrato 'unica' (o título único é lançado na ativação, via
-- fn_contrato_gerar_parcelas; o lote não gera meses seguintes).
--
-- CREATE OR REPLACE (preserva grants/privilégios atuais; nenhum dado de cliente é tocado; corpo copiado
-- verbatim da definição viva + a cláusula WHEN 'unica' THEN false). SECURITY DEFINER inalterado.

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
        WHEN 'unica' THEN false  -- evento/avulso: título único lançado na ativação; não recorre
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

-- Guardas (check_fn_guards): função SECURITY DEFINER de lote diário — executada só pelo
-- agendador/serviço (ACL viva: service_role apenas). NÃO abrir a authenticated (qualquer
-- usuário logado dispararia o processamento de TODOS os contratos da empresa).
REVOKE ALL ON FUNCTION public.fn_contrato_processar_lote_diario(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_processar_lote_diario(date) TO service_role;
