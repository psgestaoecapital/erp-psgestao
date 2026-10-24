-- TICKER DE QUALIDADE do Hub (CEO 23/10, msg b76dd837 item A) — "só LIBERA a 100%, mentir no indicador é proibido".
-- O veredito LIBERADO do fn_auditor_tela_completo (que o fn_pdca_hub_tick usa para promover estado_real='pronto')
-- passa a exigir, nas rotas do Hub (/dashboard/projetos%), os critérios 3 e 5, que o robô de print não enxerga:
--   3) CÁLCULO CORRETO  — orçamento/custo/margem/BOM/mão de obra conferidos contra caso conhecido;
--   5) FINANCEIRO VIA GE — custos/financeiro vindos do cadastro/estoque/financeiro compartilhado do GE, sem silo do Hub.
-- Cada um é uma verificação REGISTRADA (erp_hub_tela_criterio) com evidência; sem registro, com 'falhou' ou
-- vencido (> 7 dias) = gap (fail-closed). 'nao_se_aplica' (tela sem cálculo/sem custo) exige evidência dizendo por quê.
-- Também devolve o 'ticker': os 5 critérios com passou/detalhe (criterios_ok/criterios_total) para o painel.
--
-- Fora do Hub nada muda (os critérios 3/5 só entram em rota /dashboard/projetos%). Chaves novas no jsonb de retorno
-- são aditivas (quem lê 'veredito'/'gaps'/'scores' segue igual). Sem dado de cliente: a tabela é metadado de tela.
-- Plano de volta: restaurar fn_auditor_tela_completo da 20261017193355_auditor_tela_completo_gap_cast.sql
-- (a tabela e o writer novos podem ficar; ninguém mais depende deles).

CREATE TABLE IF NOT EXISTS public.erp_hub_tela_criterio (
  rota            text        NOT NULL CHECK (rota LIKE '/dashboard/projetos%'),
  criterio        text        NOT NULL CHECK (criterio IN ('calculo_correto','financeiro_via_ge')),
  situacao        text        NOT NULL CHECK (situacao IN ('passou','falhou','nao_se_aplica')),
  evidencia       text        NOT NULL CHECK (length(btrim(evidencia)) >= 20),
  caso_conhecido  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  verificado_por  text        NOT NULL,
  verificado_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rota, criterio)
);
COMMENT ON TABLE public.erp_hub_tela_criterio IS
  'Ticker de qualidade do Hub (CEO 23/10): verificação registrada dos critérios 3 (cálculo correto contra caso conhecido) e 5 (financeiro/custos via GE integrado) por tela. Sem registro, falhou ou vencido (>7 dias) = tela não LIBERA. Escrita só por fn_hub_tela_criterio_registrar.';

ALTER TABLE public.erp_hub_tela_criterio ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_hub_tela_criterio_leitura_admin ON public.erp_hub_tela_criterio;
CREATE POLICY erp_hub_tela_criterio_leitura_admin ON public.erp_hub_tela_criterio
  FOR SELECT TO authenticated USING (public.is_admin());
REVOKE ALL ON public.erp_hub_tela_criterio FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.erp_hub_tela_criterio FROM authenticated;
GRANT SELECT ON public.erp_hub_tela_criterio TO authenticated;
GRANT ALL ON public.erp_hub_tela_criterio TO service_role;

-- Writer único: serviço (auditor/Code, sem auth.uid) ou admin logado. 'passou' e 'nao_se_aplica' exigem evidência;
-- 'passou' em cálculo exige o caso conhecido (entrada + esperado + obtido).
CREATE OR REPLACE FUNCTION public.fn_hub_tela_criterio_registrar(
  p_rota text, p_criterio text, p_situacao text, p_evidencia text,
  p_caso_conhecido jsonb DEFAULT '{}'::jsonb, p_verificado_por text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_por text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'sem permissão para fn_hub_tela_criterio_registrar' USING ERRCODE='42501';
  END IF;
  IF p_criterio = 'calculo_correto' AND p_situacao = 'passou'
     AND NOT (coalesce(p_caso_conhecido,'{}'::jsonb) ?& ARRAY['entrada','esperado','obtido']) THEN
    RAISE EXCEPTION 'cálculo só passa com caso conhecido: entrada, esperado e obtido' USING ERRCODE='22023';
  END IF;
  v_por := coalesce(nullif(btrim(p_verificado_por),''), auth.uid()::text);
  IF v_por IS NULL THEN
    RAISE EXCEPTION 'informe quem verificou (p_verificado_por)' USING ERRCODE='22023';
  END IF;
  INSERT INTO erp_hub_tela_criterio(rota, criterio, situacao, evidencia, caso_conhecido, verificado_por, verificado_em)
  VALUES (p_rota, p_criterio, p_situacao, p_evidencia, coalesce(p_caso_conhecido,'{}'::jsonb), v_por, now())
  ON CONFLICT (rota, criterio) DO UPDATE
    SET situacao=EXCLUDED.situacao, evidencia=EXCLUDED.evidencia, caso_conhecido=EXCLUDED.caso_conhecido,
        verificado_por=EXCLUDED.verificado_por, verificado_em=EXCLUDED.verificado_em;
  RETURN jsonb_build_object('ok',true,'rota',p_rota,'criterio',p_criterio,'situacao',p_situacao);
END; $function$;
REVOKE ALL ON FUNCTION public.fn_hub_tela_criterio_registrar(text,text,text,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_tela_criterio_registrar(text,text,text,text,jsonb,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_auditor_tela_completo(p_rota text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE i record; g record; c3 record; c5 record; v_falta int; v_gaps text[]; v_verdict text;
        v_hub boolean; v_ticker jsonb; v_ok3 boolean; v_ok5 boolean; v_det3 text; v_det5 text;
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

  -- Critérios 3 e 5 (só Hub): verificação registrada, não vencida, passou ou não se aplica (fail-closed).
  v_hub := p_rota LIKE '/dashboard/projetos%';
  IF v_hub THEN
    SELECT * INTO c3 FROM erp_hub_tela_criterio WHERE rota=p_rota AND criterio='calculo_correto';
    SELECT * INTO c5 FROM erp_hub_tela_criterio WHERE rota=p_rota AND criterio='financeiro_via_ge';
    v_ok3 := c3.rota IS NOT NULL AND c3.situacao IN ('passou','nao_se_aplica') AND c3.verificado_em > now() - interval '7 days';
    v_ok5 := c5.rota IS NOT NULL AND c5.situacao IN ('passou','nao_se_aplica') AND c5.verificado_em > now() - interval '7 days';
    v_det3 := CASE WHEN c3.rota IS NULL THEN 'calculo nao verificado contra caso conhecido'
                   WHEN c3.situacao = 'falhou' THEN 'calculo errado: '||c3.evidencia
                   WHEN NOT v_ok3 THEN 'verificacao de calculo vencida (>7 dias)'
                   ELSE c3.situacao||': '||c3.evidencia END;
    v_det5 := CASE WHEN c5.rota IS NULL THEN 'financeiro/custos via GE nao verificado'
                   WHEN c5.situacao = 'falhou' THEN 'financeiro fora do GE: '||c5.evidencia
                   WHEN NOT v_ok5 THEN 'verificacao de financeiro via GE vencida (>7 dias)'
                   ELSE c5.situacao||': '||c5.evidencia END;
    IF NOT v_ok3 THEN v_gaps := v_gaps || ('criterio 3: '||v_det3); END IF;
    IF NOT v_ok5 THEN v_gaps := v_gaps || ('criterio 5: '||v_det5); END IF;
    v_ticker := jsonb_build_array(
      jsonb_build_object('n',1,'criterio','tela','nome','Tela (?, visual, consistência)',
        'passou', COALESCE(i.score_visual,0) >= 90 AND COALESCE(i.score_consistencia,0) >= 90,
        'detalhe','visual '||COALESCE(i.score_visual,0)||' · consistencia '||COALESCE(i.score_consistencia,0)),
      jsonb_build_object('n',2,'criterio','funcoes','nome','Funções e funcionalidades',
        'passou', COALESCE(i.score_funcional,0) >= 90 AND v_falta = 0
                  AND COALESCE(g.veredito_final,'PENDENTE') NOT IN ('BLOQUEADO','PENDENTE'),
        'detalhe','funcional '||COALESCE(i.score_funcional,0)||' · '||v_falta||' faltando · gold='||COALESCE(g.veredito_final,'PENDENTE')),
      jsonb_build_object('n',3,'criterio','calculo_correto','nome','Cálculos corretos (caso conhecido)',
        'passou', v_ok3, 'detalhe', v_det3, 'verificado_em', c3.verificado_em),
      jsonb_build_object('n',4,'criterio','dado_bate_banco','nome','Dado bate com o banco',
        'passou', COALESCE(i.bate_com_banco,false), 'detalhe', CASE WHEN COALESCE(i.bate_com_banco,false) THEN 'ok' ELSE 'dado nao bate com banco' END),
      jsonb_build_object('n',5,'criterio','financeiro_via_ge','nome','Financeiro e custos via GE',
        'passou', v_ok5, 'detalhe', v_det5, 'verificado_em', c5.verificado_em));
  END IF;

  v_verdict := CASE WHEN array_length(v_gaps,1) IS NULL THEN 'LIBERADO' ELSE 'BLOQUEADO' END;
  RETURN jsonb_build_object('rota',p_rota,'veredito',v_verdict,
    'scores',jsonb_build_object('visual',i.score_visual,'funcional',i.score_funcional,'consistencia',i.score_consistencia),
    'dado_bate_banco',i.bate_com_banco,'features_faltando',to_jsonb(i.features_faltando),
    'gold',g.veredito_final,'gaps',to_jsonb(v_gaps),'analisado_em',i.analisado_em)
    || CASE WHEN v_hub THEN jsonb_build_object('ticker',v_ticker,
         'criterios_ok',(SELECT count(*) FROM jsonb_array_elements(v_ticker) t WHERE (t->>'passou')::boolean),
         'criterios_total',5) ELSE '{}'::jsonb END;
END; $function$;
REVOKE ALL ON FUNCTION public.fn_auditor_tela_completo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_auditor_tela_completo(text) TO authenticated, service_role;
