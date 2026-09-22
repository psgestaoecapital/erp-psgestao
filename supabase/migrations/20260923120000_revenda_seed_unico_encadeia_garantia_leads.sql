-- RD-69 (seed único) · a garantia (A) e os leads (T15) da demonstração Revenda passam a nascer do PRÓPRIO
-- seed único fn_gold_revenda_seed_reparar — antes só o fn_demo_reset os encadeava, então rodar o gold seed
-- direto criava 0 leads (o Eng. Chefe teve de chamar fn_demo_seed_revenda_leads à mão). Agora o gold seed
-- chama as duas sementes ao final (ambas idempotentes/auto-resetáveis), tornando a demo completa por um
-- caminho só. fn_demo_reset segue chamando o gold seed e reporta as contagens (prova).
--
-- Edição CIRÚRGICA e IDEMPOTENTE: injeta duas linhas PERFORM imediatamente antes do RETURN final do gold
-- seed (âncora única: o RETURN de sucesso começa por 'ok', true, 'criou', v_criou — o guard usa 'ok', false).
-- Não reescreve o corpo (18 KB): lê a definição viva e recria com as duas chamadas. Preserva SECURITY
-- DEFINER e os grants (REVOKE anon já vigente sobrevive ao CREATE OR REPLACE).

DO $mig$
DECLARE
  v_def text := pg_get_functiondef('public.fn_gold_revenda_seed_reparar'::regproc);
  v_ancora text := 'RETURN jsonb_build_object(''ok'', true, ''criou'', v_criou,';
  v_novo text;
BEGIN
  IF v_def ILIKE '%fn_demo_seed_revenda_leads%' THEN
    RAISE NOTICE 'fn_gold_revenda_seed_reparar já encadeia os leads — nada a fazer.';
    RETURN;
  END IF;
  IF position(v_ancora IN v_def) = 0 THEN
    RAISE EXCEPTION 'âncora do RETURN final não encontrada em fn_gold_revenda_seed_reparar — abortando (revisar manualmente)';
  END IF;
  v_novo := replace(
    v_def,
    v_ancora,
    'PERFORM public.fn_demo_seed_revenda_garantia(p_company_id);' || chr(10) ||
    '  PERFORM public.fn_demo_seed_revenda_leads(p_company_id);'   || chr(10) ||
    '  ' || v_ancora
  );
  EXECUTE v_novo;
END $mig$;
