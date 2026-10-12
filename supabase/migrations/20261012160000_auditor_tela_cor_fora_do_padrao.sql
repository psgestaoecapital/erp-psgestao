-- Auditor Completo de Tela: cor fora da identidade PS derruba o veredito a BLOQUEADO (CEO 12/10).
-- O Insight IA marca bug visual de cor com o prefixo "COR: " (insight-auditor); aqui vira o gap "cor fora do padrao".
CREATE OR REPLACE FUNCTION public.fn_auditor_tela_completo(p_rota text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE i record; g record; v_falta int; v_gaps text[]; v_verdict text; v_cor int;
BEGIN
  SELECT * INTO i FROM system_screens_insights WHERE rota=p_rota ORDER BY analisado_em DESC LIMIT 1;
  SELECT * INTO g FROM gold_veredito_triplo WHERE rota=p_rota ORDER BY executado_em DESC LIMIT 1;
  IF i.rota IS NULL AND g.rota IS NULL THEN
    RETURN jsonb_build_object('rota',p_rota,'veredito','SEM_AUDITORIA','gaps',to_jsonb(ARRAY['nunca auditada']));
  END IF;
  v_gaps := ARRAY[]::text[];
  v_falta := COALESCE(array_length(i.features_faltando,1),0);
  SELECT count(*) INTO v_cor FROM unnest(COALESCE(i.bugs_visuais_detectados, ARRAY[]::text[])) b WHERE b ILIKE 'COR:%';
  IF COALESCE(i.score_visual,0) < 90 THEN v_gaps := v_gaps || ('visual '||COALESCE(i.score_visual,0)||'/90'); END IF;
  IF COALESCE(i.score_funcional,0) < 90 THEN v_gaps := v_gaps || ('funcional '||COALESCE(i.score_funcional,0)||'/90'); END IF;
  IF COALESCE(i.score_consistencia,0) < 90 THEN v_gaps := v_gaps || ('consistencia '||COALESCE(i.score_consistencia,0)||'/90'); END IF;
  IF NOT COALESCE(i.bate_com_banco,false) THEN v_gaps := v_gaps || 'dado nao bate com banco'; END IF;
  IF v_falta > 0 THEN v_gaps := v_gaps || (v_falta||' feature(s) faltando'); END IF;
  IF v_cor > 0 THEN v_gaps := v_gaps || ('cor fora do padrao ('||v_cor||')'); END IF;
  IF COALESCE(g.veredito_final,'PENDENTE') IN ('BLOQUEADO','PENDENTE') THEN v_gaps := v_gaps || ('gold='||COALESCE(g.veredito_final,'PENDENTE')); END IF;
  v_verdict := CASE WHEN array_length(v_gaps,1) IS NULL THEN 'LIBERADO' ELSE 'BLOQUEADO' END;
  RETURN jsonb_build_object('rota',p_rota,'veredito',v_verdict,
    'scores',jsonb_build_object('visual',i.score_visual,'funcional',i.score_funcional,'consistencia',i.score_consistencia),
    'dado_bate_banco',i.bate_com_banco,'features_faltando',to_jsonb(i.features_faltando),
    'cor_fora_do_padrao',v_cor,
    'gold',g.veredito_final,'gaps',to_jsonb(v_gaps),'analisado_em',i.analisado_em);
END; $function$;
