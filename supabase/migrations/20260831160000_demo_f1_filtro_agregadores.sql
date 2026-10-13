-- DEMO-F1 §2.2 · Filtro nos agregadores globais — PARTE 2 (validada §2.3).
-- A triagem corrigiu a lista ✅ do SPEC (RD-44):
--   • fn_auditor_matriz_briefing  → per-company (WHERE id = v_run.company_id) — NÃO agrega, não filtra.
--   • fn_truth_audit_saldo_unificado → hardcoded a 2 empresas — demo já fora, não filtra.
--   • fn_psgc_*consolidada/abc/dre e fn_truth_audit_executar_todas → não tocam companies
--     (agregam via tabelas financeiras; a demo não tem DRE) — inspeção individual em parte 3.
-- Aqui entram os 3 agregadores que referenciam companies com escopo GLOBAL (incluem a demo):
--   fn_gerar_manual_vivo_diario, fn_sync_resumo_empresas, fn_supervisor_dashboard.
-- Técnica cirúrgica com guard de ocorrência única (RD-53, zero transcrição).

DO $$
DECLARE v_def text; v_new text; v_oc int; item jsonb;
  alvos jsonb := '[
    {"fn":"fn_gerar_manual_vivo_diario","de":"FROM companies WHERE is_active = true)","para":"FROM companies_producao WHERE is_active = true)"},
    {"fn":"fn_sync_resumo_empresas","de":"FROM companies c","para":"FROM companies_producao c"},
    {"fn":"fn_supervisor_dashboard","de":"FROM companies c","para":"FROM companies_producao c"}
  ]';
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(alvos) LOOP
    SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
      WHERE proname=(item->>'fn') AND pronamespace='public'::regnamespace;
    IF v_def IS NULL THEN RAISE EXCEPTION '% nao encontrada', item->>'fn'; END IF;
    -- idempotente: se já aponta para companies_producao, pula
    IF position(item->>'para' IN v_def) > 0 THEN CONTINUE; END IF;
    v_oc := (length(v_def) - length(replace(v_def, item->>'de', ''))) / length(item->>'de');
    IF v_oc <> 1 THEN RAISE EXCEPTION '% : esperava 1 ancora [%], achei %', item->>'fn', item->>'de', v_oc; END IF;
    v_new := replace(v_def, item->>'de', item->>'para');
    EXECUTE v_new;
  END LOOP;
END $$;
