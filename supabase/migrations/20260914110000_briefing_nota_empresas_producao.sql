-- ============================================================
-- Briefing · nota no empresas_resumo — 0e580f96 aplicada a um NÚMERO
-- ============================================================
-- O briefing conta a view companies_producao (WHERE ambiente_tenant='producao'), então demos/sandboxes/
-- auditoria JÁ ficam fora do total — mas em silêncio. Foi por isso que se perdeu tempo achando que a
-- demo entrava na conta. Uma linha ('nota') explica o que o número representa e evita a próxima
-- investigação inútil. Não muda o número — só o explica.
--
-- Patch CIRÚRGICO: fn_briefing_sessao tem 213 linhas e roda em TODA sessão — reescrevê-la à mão é risco
-- de transcrição (RD-52). Em vez disso, lê o fonte vivo, troca SÓ o fragmento do empresas_resumo,
-- ABORTA se não achar (nunca altera às cegas) e é IDEMPOTENTE (pula se já aplicado).

DO $patch$
DECLARE v_src text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src FROM pg_proc WHERE proname='fn_briefing_sessao';
  IF v_src IS NULL THEN RAISE EXCEPTION 'fn_briefing_sessao não existe'; END IF;
  IF v_src ILIKE '%demos e sandboxes fora%' THEN RETURN; END IF;   -- já aplicado → no-op idempotente
  v_new := replace(v_src,
    $frag$jsonb_build_object('total',COUNT(*),'ativas',COUNT(*) FILTER (WHERE is_active=true)) FROM companies_producao$frag$,
    $frag$jsonb_build_object('total',COUNT(*),'ativas',COUNT(*) FILTER (WHERE is_active=true),'nota','produção; demos e sandboxes fora') FROM companies_producao$frag$);
  IF v_new = v_src THEN
    RAISE EXCEPTION 'fragmento empresas_resumo não encontrado em fn_briefing_sessao — abortando (não altero às cegas)';
  END IF;
  EXECUTE v_new;
END $patch$;
