-- Auditor PDCA · fn_auditor_tela_completo lê a nota do aud8 da fonte VIVA (erp_auditor_matriz_resultados)
--
-- Provado (31/10): a função pegava o score do aud8 só de system_screens_insights (tabela do auditor pago, CONGELADA
-- desde 30/10) + gold_veredito_triplo, mas o aud8 hoje grava em erp_auditor_matriz_resultados (via fn_matriz_registrar_nota).
-- Resultado: os auditores PDCA viam nota VELHA mesmo após o aud8 reavaliar (ex.: /dashboard/projetos/calculadora =
-- insights 75/55/60 de 30/10, mas matriz score_pct=90 de 31/10).
--
-- CONSERTO (só a obtenção da nota/score do aud8; o RESTO da função é preservado): usa PRIMEIRO a nota mais recente da
-- matriz para a rota (status='completo', score_pct não nulo, split_part(rota_completa,'?',1)=rota, ORDER BY consultado_em
-- DESC — mesma lógica de fn_codes_qualidade_vertical) e só cai para system_screens_insights se a rota não tiver nota na
-- matriz. Devolve também a data da nota usada (nota_em) e a fonte (nota_fonte = matriz|insights). bate_com_banco,
-- features_faltando e gold seguem de insights/gold como antes. CREATE OR REPLACE preserva os grants atuais.

CREATE OR REPLACE FUNCTION public.fn_auditor_tela_completo(p_rota text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE i record; g record; m record; v_falta int; v_gaps text[]; v_verdict text;
        v_fonte text; v_nota_em timestamptz; v_aud8 int;
BEGIN
  SELECT * INTO i FROM system_screens_insights WHERE rota = p_rota ORDER BY analisado_em DESC LIMIT 1;
  SELECT * INTO g FROM gold_veredito_triplo WHERE rota = p_rota ORDER BY executado_em DESC LIMIT 1;
  -- nota VIVA do aud8 (matriz): a mais recente, completa e com score, casando a rota base
  SELECT * INTO m FROM erp_auditor_matriz_resultados
    WHERE split_part(rota_completa, '?', 1) = p_rota AND status = 'completo' AND score_pct IS NOT NULL
    ORDER BY consultado_em DESC LIMIT 1;

  IF i.rota IS NULL AND g.rota IS NULL AND m.id IS NULL THEN
    RETURN jsonb_build_object('rota', p_rota, 'veredito', 'SEM_AUDITORIA', 'gaps', to_jsonb(ARRAY['nunca auditada']));
  END IF;

  v_gaps := ARRAY[]::text[];
  v_falta := COALESCE(array_length(i.features_faltando, 1), 0);

  IF m.id IS NOT NULL THEN
    -- fonte VIVA: a nota do aud8 vem da matriz (meta 95); sub-scores de insights ficam só informativos
    v_fonte := 'matriz'; v_nota_em := m.consultado_em; v_aud8 := m.score_pct;
    IF COALESCE(v_aud8, 0) < 95 THEN v_gaps := v_gaps || ('aud8 ' || COALESCE(v_aud8, 0) || '/95'); END IF;
  ELSE
    -- sem nota na matriz: cai para insights (comportamento anterior, por dimensão < 90)
    v_fonte := 'insights'; v_nota_em := i.analisado_em;
    v_aud8 := LEAST(COALESCE(i.score_visual, 0), COALESCE(i.score_funcional, 0), COALESCE(i.score_consistencia, 0));
    IF COALESCE(i.score_visual, 0) < 90 THEN v_gaps := v_gaps || ('visual ' || COALESCE(i.score_visual, 0) || '/90'); END IF;
    IF COALESCE(i.score_funcional, 0) < 90 THEN v_gaps := v_gaps || ('funcional ' || COALESCE(i.score_funcional, 0) || '/90'); END IF;
    IF COALESCE(i.score_consistencia, 0) < 90 THEN v_gaps := v_gaps || ('consistencia ' || COALESCE(i.score_consistencia, 0) || '/90'); END IF;
  END IF;

  IF NOT COALESCE(i.bate_com_banco, false) THEN v_gaps := v_gaps || 'dado nao bate com banco'::text; END IF;
  IF v_falta > 0 THEN v_gaps := v_gaps || (v_falta || ' feature(s) faltando'); END IF;
  IF COALESCE(g.veredito_final, 'PENDENTE') IN ('BLOQUEADO', 'PENDENTE') THEN v_gaps := v_gaps || ('gold=' || COALESCE(g.veredito_final, 'PENDENTE')); END IF;

  v_verdict := CASE WHEN array_length(v_gaps, 1) IS NULL THEN 'LIBERADO' ELSE 'BLOQUEADO' END;

  RETURN jsonb_build_object('rota', p_rota, 'veredito', v_verdict,
    'scores', jsonb_build_object('visual', i.score_visual, 'funcional', i.score_funcional, 'consistencia', i.score_consistencia),
    'aud8', v_aud8, 'nota_fonte', v_fonte, 'nota_em', v_nota_em,
    'dado_bate_banco', i.bate_com_banco, 'features_faltando', to_jsonb(i.features_faltando),
    'gold', g.veredito_final, 'gaps', to_jsonb(v_gaps), 'analisado_em', i.analisado_em);
END; $function$;

-- função SECURITY DEFINER só de LEITURA (lê scores/veredito das telas); fechada a quem não está logado.
REVOKE ALL ON FUNCTION public.fn_auditor_tela_completo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_auditor_tela_completo(text) TO authenticated, service_role;
