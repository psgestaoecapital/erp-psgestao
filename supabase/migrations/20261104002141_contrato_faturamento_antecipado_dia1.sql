-- Reconciliação RD-52 (conserto-main): esta migration já estava APLICADA na produção
-- (ledger supabase_migrations.schema_migrations, versão 20261104002141), mas não tinha
-- arquivo no repo, quebrando o `supabase db push --include-all`
-- ("Remote migration versions not found in local migrations directory").
--
-- O bloco CREATE OR REPLACE abaixo é BYTE-IDÊNTICO ao que foi aplicado (conferido por
-- sha256 contra o banco: 2618fc80886b1d36ae89eb7af94f78a3093b14f29dec1285167f63ffdaa140d6).
-- Nada muda em produção: o `db push` casa pela versão e NÃO re-executa.
--
-- O REVOKE/GRANT ao final NÃO faz parte do statement aplicado (que teve só o CREATE OR
-- REPLACE); foram acrescentados para (1) satisfazer a régua check:fn-guards e (2) documentar
-- e reproduzir em builds limpos a postura de acesso REAL já vigente em produção, conferida no
-- dado (RD-38): anon=NÃO, authenticated=NÃO, PUBLIC=NÃO, service_role=SIM. Também é no-op em
-- produção (não re-executa). A função é um lote diário do SISTEMA (service_role), não é RPC de cliente.
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
REVOKE ALL ON FUNCTION public.fn_contrato_processar_lote_diario(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_contrato_processar_lote_diario(date) TO service_role;
