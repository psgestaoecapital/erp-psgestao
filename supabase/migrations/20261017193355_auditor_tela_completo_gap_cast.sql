-- Ferramenta do Code-Auditor (eng-chefe-auto): conserto de bug em fn_auditor_tela_completo.
-- Bug: `v_gaps := v_gaps || 'dado nao bate com banco'` usava literal SEM tipo; o parser escolhe
-- text[] || text[] e tenta ler o literal como array -> ERRO 22P02 "malformed array literal".
-- Acontece sempre que a tela tem bate_com_banco=false (caso comum) -> a função do auditor QUEBRA ao ler o veredito.
-- Conserto ADITIVO (RD-97): cast do literal para ::text (append de elemento). Nenhuma outra linha muda;
-- as demais concatenações já produzem text. Sem efeito em dado de cliente.
-- Plano de volta (rollback): restaurar a versão anterior de fn_auditor_tela_completo a partir do histórico
-- (trocar 'dado nao bate com banco'::text de volta por 'dado nao bate com banco').

CREATE OR REPLACE FUNCTION public.fn_auditor_tela_completo(p_rota text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE i record; g record; v_falta int; v_gaps text[]; v_verdict text;
BEGIN
  SELECT * INTO i FROM system_screens_insights WHERE rota=p_rota ORDER BY analisado_em DESC LIMIT 1;
  SELECT * INTO g FROM gold_veredito_triplo WHERE rota=p_rota ORDER BY executado_em DESC LIMIT 1;
  IF i.rota IS NULL AND g.rota IS NULL THEN
    RETURN jsonb_build_object('rota',p_rota,'veredito','SEM_AUDITORIA','gaps',to_jsonb(ARRAY['nunca auditada']));
  END IF;
  v_gaps := ARRAY[]::text[];
  v_falta := COALESCE(array_length(i.features_faltando,1),0);
  IF COALESCE(i.score_visual,0) < 90 THEN v_gaps := v_gaps || ('visual '||COALESCE(i.score_visual,0)||'/90'); END IF;
  IF COALESCE(i.score_funcional,0) < 90 THEN v_gaps := v_gaps || ('funcional '||COALESCE(i.score_funcional,0)||'/90'); END IF;
  IF COALESCE(i.score_consistencia,0) < 90 THEN v_gaps := v_gaps || ('consistencia '||COALESCE(i.score_consistencia,0)||'/90'); END IF;
  IF NOT COALESCE(i.bate_com_banco,false) THEN v_gaps := v_gaps || 'dado nao bate com banco'::text; END IF;
  IF v_falta > 0 THEN v_gaps := v_gaps || (v_falta||' feature(s) faltando'); END IF;
  IF COALESCE(g.veredito_final,'PENDENTE') IN ('BLOQUEADO','PENDENTE') THEN v_gaps := v_gaps || ('gold='||COALESCE(g.veredito_final,'PENDENTE')); END IF;
  v_verdict := CASE WHEN array_length(v_gaps,1) IS NULL THEN 'LIBERADO' ELSE 'BLOQUEADO' END;
  RETURN jsonb_build_object('rota',p_rota,'veredito',v_verdict,
    'scores',jsonb_build_object('visual',i.score_visual,'funcional',i.score_funcional,'consistencia',i.score_consistencia),
    'dado_bate_banco',i.bate_com_banco,'features_faltando',to_jsonb(i.features_faltando),
    'gold',g.veredito_final,'gaps',to_jsonb(v_gaps),'analisado_em',i.analisado_em);
END; $function$;

-- Ajuste pedido pelo gilberto-revisor: a definição VIVA é SECURITY DEFINER + SET search_path TO 'public'
-- (restaurados acima, para o CREATE OR REPLACE não rebaixar a função a SECURITY INVOKER — regressão de
-- permissão de leitura de system_screens_insights/gold_veredito_triplo). Guarda da função (check_fn_guards):
-- função só de LEITURA (SELECT), nunca aberta ao anon.
REVOKE ALL ON FUNCTION public.fn_auditor_tela_completo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_auditor_tela_completo(text) TO authenticated, service_role;
