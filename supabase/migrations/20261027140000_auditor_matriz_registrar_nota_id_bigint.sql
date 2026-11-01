-- Corrige fn_matriz_registrar_nota: o id das tabelas erp_auditor_matriz_runs e _resultados é bigint (serial), não uuid.
-- A 20261027130000 já foi aplicada em produção com retorno uuid; CREATE OR REPLACE não troca o tipo de retorno,
-- então a assinatura antiga sai antes e a nova entra. Sem chamadores no repo (checado).
-- ci-sem-guarda: fn_matriz_registrar_nota — grava só na camada de auditoria da matriz (RD-35), sem empresa no registro (company_id fica nulo); executável só por service_role (REVOKE de PUBLIC/anon/authenticated).
DROP FUNCTION IF EXISTS public.fn_matriz_registrar_nota(text, integer, text[], text[], text, text);

CREATE OR REPLACE FUNCTION public.fn_matriz_registrar_nota(
  p_rota text, p_score integer, p_bugs text[] DEFAULT '{}', p_recomendacoes text[] DEFAULT '{}',
  p_proximo_passo text DEFAULT NULL, p_area text DEFAULT 'hub')
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_run bigint; v_mod text; v_base text; v_nome text; v_scr text; v_rc text; v_id bigint;
BEGIN
  SELECT modulo_id, rota_base, modulo_nome, screen_id, rota_completa
    INTO v_mod, v_base, v_nome, v_scr, v_rc
    FROM erp_auditor_matriz_resultados
    WHERE rota_completa LIKE p_rota || '%' AND modulo_id IS NOT NULL
    ORDER BY consultado_em DESC NULLS LAST LIMIT 1;
  IF v_mod IS NULL THEN
    v_mod := regexp_replace(p_rota, '^.*/', 'projetos_'); v_base := p_rota; v_rc := p_rota;
  END IF;
  SELECT id INTO v_run FROM erp_auditor_matriz_runs
    WHERE modo = 'manual' AND trigger_origin = 'aud8-max'
      AND iniciado_em::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date
    ORDER BY id DESC LIMIT 1;
  IF v_run IS NULL THEN
    INSERT INTO erp_auditor_matriz_runs (area_id, modo, status, trigger_origin, observacao, custo_estimado_usd)
    VALUES (p_area, 'manual', 'em_andamento', 'aud8-max', 'Auditoria no Max (vazamento 2) — custo externo zero', 0)
    RETURNING id INTO v_run;
  END IF;
  INSERT INTO erp_auditor_matriz_resultados
    (run_id, modulo_id, modulo_nome, rota_base, rota_completa, screen_id, t0_dispatch,
     status, consultado_em, score_pct, bugs_detectados, recomendacoes, proximo_passo)
  VALUES (v_run, v_mod, v_nome, v_base, coalesce(v_rc, p_rota), v_scr, now(),
     'completo', now(), p_score, p_bugs, p_recomendacoes, p_proximo_passo)
  RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_matriz_registrar_nota(text,integer,text[],text[],text,text) FROM PUBLIC, anon, authenticated;
