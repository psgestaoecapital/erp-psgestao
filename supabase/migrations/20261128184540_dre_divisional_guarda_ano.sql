-- DRE divisional — o escritor valida o ANO antes de gravar, para não derrubar o job por 1 linha de ano absurdo.
-- Bug (auditor_pdca_2, provado RD-38): fn_popular_dre_divisional_from_psgc tenta INSERT em m2_dre_divisional
-- com o ano vindo de psgc_dre; quando esse ano está fora da check m2_dre_divisional_year_check (year BETWEEN
-- 2020 AND 2035), a INSERT viola a constraint, o EXCEPTION WHEN OTHERS devolve success:false e o job
-- popular_dre_divisional fica preso em erro (3/3 tentativas) — pipeline abandonado em silêncio.
-- Evidência (psgc_job_queue, status=erro): ano=2062 (b26c19c0), ano=2099 (DEMO GE b0700000-...-0004),
-- ano=2 (a462e13f) — anos claramente lixo (typo de data_competencia na origem). Atinge empresa REAL também.
-- Correção: GUARDA no topo — ano fora de [2020,2035] retorna success:true/skipped, sem tentar gravar.
-- O job conclui (sem retry storm, sem abandono); nenhum dado de cliente é apagado/alterado; nenhuma DRE
-- divisional de ano real deixa de ser escrita. Defensivo e idempotente (só CREATE OR REPLACE).
-- Observação operacional (fora desta PR): reprocessar os jobs em erro e limpar o título de ano-lixo da DEMO
-- (so-demo) são passos separados; esta PR estanca a RAIZ do abandono do pipeline por ano absurdo.
-- Code: code-desenvolvedor-3
-- ci-sem-guarda: fn_popular_dre_divisional_from_psgc — escritor de pipeline chamado só por service_role (job popular_dre_divisional), sem auth.uid de usuário; ACL restrita a service_role

CREATE OR REPLACE FUNCTION public.fn_popular_dre_divisional_from_psgc(p_company_id uuid, p_ano integer, p_mes integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_ln_default uuid;
  -- Totais por categoria PSGC (mapeamento canonico V2)
  v_total_receita numeric;            -- PSGC 1.%
  v_total_deducoes numeric;           -- PSGC 2.%
  v_total_impostos_diretos numeric;   -- PSGC 3.% (NOVO mapeamento)
  v_total_cmv numeric;                -- PSGC 4.% (CORRIGIDO)
  v_total_desp_variavel numeric;      -- PSGC 5.% (CORRIGIDO + NOVO campo)
  v_total_custo_fixo numeric;         -- PSGC 6.%
  v_total_depreciacao numeric;        -- PSGC 7.% (NOVO mapeamento)
  v_total_impostos_lucro numeric;     -- PSGC 10.% (NOVO mapeamento)
  -- Auditoria
  v_total_codigos_ignorados numeric;  -- PSGC 8.%, 9.% (resultado fin/nao-op)
  v_total_codigos_estranhos numeric;  -- codigos fora do plano
  v_lns_processadas int := 0;
  v_ln_record record;
  v_psgc_record record;
BEGIN
  -- GUARDA DE ANO (CEO/auditor 27/11): a tabela m2_dre_divisional só aceita year entre 2020 e 2035
  -- (constraint m2_dre_divisional_year_check). Ano fora dessa faixa é lixo de origem (typo de competência).
  -- Pular limpo em vez de deixar a INSERT violar a constraint e derrubar o job inteiro (retry storm / abandono).
  IF p_ano IS NULL OR p_ano < 2020 OR p_ano > 2035 THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'motivo', 'ano_fora_de_faixa',
      'ano', p_ano,
      'mes', p_mes,
      'faixa_valida', '2020..2035',
      'mapeamento_versao', 'V2_canonical_06_05_2026'
    );
  END IF;

  -- DEFENSIVO: garante que empresa tem ao menos 1 LN
  v_ln_default := fn_garantir_ln_default(p_company_id);

  FOR v_ln_record IN
    SELECT id, name FROM business_lines
    WHERE company_id = p_company_id AND is_active = true
    ORDER BY ln_number
  LOOP
    -- Reset totais para esta LN
    v_total_receita := 0;
    v_total_deducoes := 0;
    v_total_impostos_diretos := 0;
    v_total_cmv := 0;
    v_total_desp_variavel := 0;
    v_total_custo_fixo := 0;
    v_total_depreciacao := 0;
    v_total_impostos_lucro := 0;
    v_total_codigos_ignorados := 0;
    v_total_codigos_estranhos := 0;

    -- Iterar PSGC desta LN (ou default LN se ln_id NULL)
    FOR v_psgc_record IN
      SELECT psgc_codigo, valor, ln_id FROM psgc_dre
      WHERE company_id = p_company_id
        AND ano = p_ano
        AND mes = p_mes
        AND (ln_id = v_ln_record.id OR (ln_id IS NULL AND v_ln_record.id = v_ln_default))
    LOOP
      -- Mapeamento PSGC canonico V2 (corrigido 06/05/2026)
      CASE
        WHEN v_psgc_record.psgc_codigo LIKE '1.%' OR v_psgc_record.psgc_codigo = '1' THEN
          v_total_receita := v_total_receita + v_psgc_record.valor;

        WHEN v_psgc_record.psgc_codigo LIKE '2.%' OR v_psgc_record.psgc_codigo = '2' THEN
          v_total_deducoes := v_total_deducoes + v_psgc_record.valor;

        WHEN v_psgc_record.psgc_codigo LIKE '3.%' OR v_psgc_record.psgc_codigo = '3' THEN
          v_total_impostos_diretos := v_total_impostos_diretos + v_psgc_record.valor;

        WHEN v_psgc_record.psgc_codigo LIKE '4.%' OR v_psgc_record.psgc_codigo = '4' THEN
          v_total_cmv := v_total_cmv + v_psgc_record.valor;

        WHEN v_psgc_record.psgc_codigo LIKE '5.%' OR v_psgc_record.psgc_codigo = '5' THEN
          v_total_desp_variavel := v_total_desp_variavel + v_psgc_record.valor;

        WHEN v_psgc_record.psgc_codigo LIKE '6.%' OR v_psgc_record.psgc_codigo = '6' THEN
          v_total_custo_fixo := v_total_custo_fixo + v_psgc_record.valor;

        WHEN v_psgc_record.psgc_codigo LIKE '7.%' OR v_psgc_record.psgc_codigo = '7' THEN
          v_total_depreciacao := v_total_depreciacao + v_psgc_record.valor;

        WHEN v_psgc_record.psgc_codigo LIKE '8.%' OR v_psgc_record.psgc_codigo = '8'
          OR v_psgc_record.psgc_codigo LIKE '9.%' OR v_psgc_record.psgc_codigo = '9' THEN
          -- Resultado financeiro (8) e nao-operacional (9) NAO entram em DRE divisional
          -- Eles ficam apenas na DRE consolidada
          v_total_codigos_ignorados := v_total_codigos_ignorados + v_psgc_record.valor;

        WHEN v_psgc_record.psgc_codigo LIKE '10.%' OR v_psgc_record.psgc_codigo = '10' THEN
          v_total_impostos_lucro := v_total_impostos_lucro + v_psgc_record.valor;

        ELSE
          -- Codigo estranho - registrar para auditoria mas nao silenciar
          v_total_codigos_estranhos := v_total_codigos_estranhos + v_psgc_record.valor;
      END CASE;
    END LOOP;

    -- UPSERT em m2_dre_divisional
    INSERT INTO m2_dre_divisional (
      company_id, ln_id, year, month,
      receita_bruta, deducoes, impostos_diretos, cmv,
      despesa_variavel_venda, custo_fixo_direto,
      depreciacao_amortizacao, impostos_lucro,
      source, api_sync_at, created_at, updated_at
    ) VALUES (
      p_company_id, v_ln_record.id, p_ano, p_mes,
      v_total_receita, v_total_deducoes, v_total_impostos_diretos, v_total_cmv,
      v_total_desp_variavel, v_total_custo_fixo,
      v_total_depreciacao, v_total_impostos_lucro,
      'manual', now(), now(), now()
    )
    ON CONFLICT (company_id, ln_id, year, month) DO UPDATE SET
      receita_bruta = EXCLUDED.receita_bruta,
      deducoes = EXCLUDED.deducoes,
      impostos_diretos = EXCLUDED.impostos_diretos,
      cmv = EXCLUDED.cmv,
      despesa_variavel_venda = EXCLUDED.despesa_variavel_venda,
      custo_fixo_direto = EXCLUDED.custo_fixo_direto,
      depreciacao_amortizacao = EXCLUDED.depreciacao_amortizacao,
      impostos_lucro = EXCLUDED.impostos_lucro,
      api_sync_at = now(),
      updated_at = now();

    v_lns_processadas := v_lns_processadas + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'lns_processadas', v_lns_processadas,
    'ano', p_ano,
    'mes', p_mes,
    'mapeamento_versao', 'V2_canonical_06_05_2026',
    'codigos_ignorados_8_9', v_total_codigos_ignorados,
    'codigos_estranhos_fora_plano', v_total_codigos_estranhos
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'mapeamento_versao', 'V2_canonical_06_05_2026'
  );
END;
$function$;

-- ACL da função SECURITY DEFINER recriada (check_fn_guards): espelha a ACL viva
-- (só service_role — escritor de pipeline; anon/PUBLIC/authenticated revogados). Conteúdo da função inalterado.
REVOKE ALL ON FUNCTION public.fn_popular_dre_divisional_from_psgc(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_popular_dre_divisional_from_psgc(uuid, integer, integer) TO service_role;
