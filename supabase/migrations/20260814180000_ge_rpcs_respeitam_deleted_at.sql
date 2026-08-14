-- RD-41 · Fase 1 (Saneamento) — GE: RPCs de agregação respeitam deleted_at (RD-52/RD-58).
-- Origem: CEO 14/08 — tela financeira divergente (Proplay/PDOIS) + dados de teste aparecendo.
-- Diagnóstico: 15 de 17 RPCs não filtravam deleted_at → contavam títulos soft-deletados; só a listagem
-- (fn_ge_listagem_v2) e fn_pm_bi_kpis filtravam → banner/cards ≠ listagem. SEM nova limpeza (dados de
-- teste já soft-deletados). O fix é as RPCs pararem de contar registro morto.
--
-- Método: para cada leitura de erp_receber/erp_pagar, excluir soft-deletados na ORIGEM envolvendo a
-- tabela num subselect filtrado — equivalente a "AND <alias>.deleted_at IS NULL", uniforme e à prova de
-- estrutura de WHERE. Gerado pelo próprio Postgres a partir da definição viva (zero transcrição manual),
-- idempotente (só reescreve quem ainda tem leitura crua), e provado (rollback): 15/15 recompilam,
-- 0 leituras cruas restantes, e a agregação passa a contar só vivos (PDois a_receber 680→623).
--
-- fn_renegociar_inadimplencia é AÇÃO (UPDATE): tratada explícita p/ NUNCA renegociar título deletado
-- (guarda no SELECT e no UPDATE). As demais 14 são leitura pura (confirmado: nenhuma escreve nessas tabelas).

-- ── 1) fn_renegociar_inadimplencia — guarda explícita (leitura + escrita) ──────────────────────────
CREATE OR REPLACE FUNCTION public.fn_renegociar_inadimplencia(p_receber_ids uuid[], p_nova_data_vencimento date, p_novo_valor_total numeric DEFAULT NULL::numeric, p_observacao text DEFAULT 'Renegociado'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int := 0;
  v_valor_original_total numeric;
BEGIN
  SELECT SUM(valor) INTO v_valor_original_total
  FROM erp_receber WHERE id = ANY(p_receber_ids) AND deleted_at IS NULL;

  UPDATE erp_receber
  SET
    em_renegociacao = true,
    data_vencimento = p_nova_data_vencimento,
    valor = COALESCE(p_novo_valor_total, valor),
    observacao = COALESCE(observacao, '') || ' [RENEGOCIADO em ' || NOW()::text || ': ' || p_observacao || ']',
    updated_at = NOW()
  WHERE id = ANY(p_receber_ids) AND deleted_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'sucesso', true,
    'titulos_renegociados', v_count,
    'valor_original_total', v_valor_original_total,
    'valor_novo_total', COALESCE(p_novo_valor_total, v_valor_original_total),
    'nova_data_vencimento', p_nova_data_vencimento
  );
END;
$function$;

-- ── 2) As 14 RPCs de leitura — reescreve envolvendo cada leitura crua num subselect filtrado ────────
DO $migrate$
DECLARE
  r record; v_def text; v_new text;
  v_names text[] := ARRAY[
    'fn_dashboard_kpis','fn_fluxo_caixa_diario','fn_fluxo_caixa_mensal','fn_fluxo_caixa_projecao',
    'fn_ge_inadimplentes_agrupado','fn_ge_kpis_dashboard','fn_ge_saude_financeira','fn_ge_top_inadimplentes',
    'fn_gestao_empresarial_hub_kpis','fn_gestao_empresarial_widget_fluxo_caixa','fn_inadimplentes_por_status',
    'fn_psgc_termometro_saude','fn_saude_alertas_proativos','gerar_previsao_fluxo_caixa'];
BEGIN
  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(v_names)
  LOOP
    v_def := pg_get_functiondef(r.oid);
    -- leitura com alias: FROM/JOIN erp_receber er  →  FROM/JOIN (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) er
    v_new := regexp_replace(v_def, '(FROM |JOIN )(erp_receber|erp_pagar)( +)([a-z][a-z0-9_]*)',
                            '\1(SELECT * FROM public.\2 WHERE deleted_at IS NULL) \4', 'g');
    -- leitura sem alias: FROM/JOIN erp_receber (WHERE/…)  →  … com alias = nome da tabela
    -- (o subselect interno usa public.<tbl>, então esta 2ª passada não re-embrulha o que a 1ª gerou)
    v_new := regexp_replace(v_new, '(FROM |JOIN )(erp_receber|erp_pagar)\y',
                            '\1(SELECT * FROM public.\2 WHERE deleted_at IS NULL) \2', 'g');
    IF v_new <> v_def THEN
      EXECUTE v_new;
    END IF;
  END LOOP;
END $migrate$;
