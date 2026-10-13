-- Alerta de VALIDADE DE CERTIFICADOS no briefing (CEO 24/09/2026) — A1 fiscal + comunicação bancária.
-- Autoria: sessão Claude (pedido do CEO). Escalonado por urgência:
--   30 dias  → só no briefing (campo novo alertas_certificados). É aviso, dá tempo.
--   7 dias   → briefing E alertas_pendentes_para_ceo (precisa estar na frente do CEO).
--   vencido  → alertas_pendentes_para_ceo sempre, até resolver.
-- Motivo (CEO): quem renova é o contador/cliente, não ele — a 7d/vencido tem de furar o briefing e ir ao painel do CEO.
--
-- Fontes: erp_certificados_a1.validade_fim (A1 fiscal, extraído no upload) + erp_banco_provider_config.cert_expira_em
-- (comunicação bancária, gravado no salvar desde o #1777). Ambos vencem e derrubam a operação sem aviso.
--
-- ADITIVO (prova em rollback obrigatória): os campos atuais (checklist_obrigatoria_claude,
-- rd38_doutrina_verdade_absoluta, ultimo_handoff, alertas_pendentes_para_ceo) saem IDÊNTICOS quando não há
-- cert ≤7d/vencido. O bloco novo (alertas_certificados) só ACRESCENTA; a chave certificados_criticos só é
-- inserida em alertas_pendentes_para_ceo quando há crítico (jsonb_set, sem tocar as chaves existentes).
-- Corpo reproduzido VERBATIM da definição viva (pg_get_functiondef) — só somam 2 vars e 3 linhas no fim.

CREATE OR REPLACE FUNCTION public.fn_briefing_sessao()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_ultimo_handoff record;
  v_ultimo_snapshot record;
  v_truth_pendentes jsonb;
  v_insights_pendentes jsonb;
  v_telas_refacao jsonb;
  v_contrato_v1_ativo jsonb;
  v_saneamento jsonb;
  v_rd38_validacao_prs jsonb;
  v_rd38_rejeicoes_insight jsonb;
  v_rd38_falhas_playwright jsonb;
  v_rd38_falhas_cron jsonb;
  v_alertas_certificados jsonb;   -- NOVO (alerta de validade de certificados)
  v_certs_criticos jsonb;         -- NOVO (≤7d ou vencido → vai para alertas_pendentes_para_ceo)
BEGIN
  SELECT * INTO v_ultimo_handoff FROM erp_handoff_sessao ORDER BY criado_em DESC LIMIT 1;
  SELECT * INTO v_ultimo_snapshot FROM manual_vivo_diario ORDER BY hora_snapshot DESC LIMIT 1;

  SELECT jsonb_agg(jsonb_build_object('id',id,'severity',severity,'area',area,'tipo',tipo_divergencia,'mensagem',mensagem,'detected_at',detected_at,'recomendacao',recomendacao)) INTO v_truth_pendentes
  FROM (
    SELECT id,severity,area,tipo_divergencia,mensagem,detected_at,recomendacao FROM erp_truth_alerts
    WHERE status='novo' AND severity IN ('critical','high') AND (apresentado_ceo=false OR apresentado_ceo IS NULL)
    ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END, detected_at DESC LIMIT 10
  ) t;

  SELECT jsonb_agg(jsonb_build_object('rota',rota,'score_evolucao_pct',score_evolucao_pct,'score_visual',score_visual,'bugs_visuais',bugs_visuais_detectados,'proximo_passo',proximo_passo_sugerido,'analisado_em',analisado_em)) INTO v_insights_pendentes
  FROM (
    SELECT rota,score_evolucao_pct,score_visual,bugs_visuais_detectados,proximo_passo_sugerido,analisado_em FROM system_screens_insights
    WHERE (apresentado_ceo=false OR apresentado_ceo IS NULL) AND (score_evolucao_pct<30 OR score_visual<30)
    ORDER BY score_evolucao_pct ASC NULLS LAST, analisado_em DESC LIMIT 5
  ) t;

  SELECT jsonb_agg(jsonb_build_object('rota_alvo',rota_alvo,'vezes_mexida_30d',vezes,'ultima_intervencao',ultima)) INTO v_telas_refacao
  FROM (
    SELECT rota_alvo,COUNT(*) as vezes,MAX(data_ref)::date as ultima FROM (
      SELECT
        CASE
          WHEN titulo ~* 'dashboard.?home|painel.geral|home/' THEN '/dashboard/home'
          WHEN titulo ~* 'analises|analise' THEN '/dashboard/analises'
          WHEN titulo ~* 'financeiro' THEN '/dashboard/financeiro'
          WHEN titulo ~* 'bpo' THEN '/dashboard/bpo'
          WHEN titulo ~* 'wealth' THEN '/dashboard/wealth'
          WHEN titulo ~* 'compliance' THEN '/dashboard/compliance'
          WHEN titulo ~* 'commerce' THEN '/dashboard/commerce'
          ELSE NULL
        END as rota_alvo,
        criado_em as data_ref
      FROM erp_contexto_projeto
      WHERE criado_em > NOW() - INTERVAL '30 days'
        AND categoria IN ('decisao','bug','descoberta','arquitetura')
        AND (titulo ~* 'dashboard|home|painel|reenquadramento|refactor|redesign|fix|hotfix' OR tags && ARRAY['refactor','reenquadramento','redesign'])
    ) base WHERE rota_alvo IS NOT NULL GROUP BY rota_alvo HAVING COUNT(*) >= 3 ORDER BY COUNT(*) DESC
  ) t;

  v_contrato_v1_ativo := jsonb_build_object(
    'contrato_v1_vigente', true,
    'id_contexto', 'dfe6e08f-bbb3-4a37-b3bd-803f120d2d29',
    'aviso', 'Contrato V1 ativo. CEO interrompe citando Contrato item X.',
    'protocolo_obrigatorio', 'Síntese 3 linhas após briefing (Seção 1.5)'
  );

  SELECT row_to_json(v.*)::jsonb INTO v_saneamento FROM v_saneamento_estado v LIMIT 1;

  -- RD-38: validacao PRs
  v_rd38_validacao_prs := fn_rd38_prs_pendentes_validacao(72);

  -- RD-38: rejeicoes Insight Auditor
  SELECT jsonb_build_object(
    'total_24h', (SELECT COUNT(*) FROM rd38_insight_rejeicoes WHERE detectado_em > NOW() - INTERVAL '24 hours'),
    'pendentes', (SELECT COUNT(*) FROM rd38_insight_rejeicoes WHERE status = 'novo'),
    'ultimas_5', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'request_id', request_id_origem, 'detectado_em', detectado_em,
        'mensagem', mensagem_rejeicao, 'count', count_retornado, 'status', status
      ) ORDER BY detectado_em DESC)
      FROM (SELECT * FROM rd38_insight_rejeicoes ORDER BY detectado_em DESC LIMIT 5) t
    ), '[]'::jsonb)
  ) INTO v_rd38_rejeicoes_insight;

  -- RD-38 NOVO: falhas Playwright
  SELECT jsonb_build_object(
    'total_24h', (SELECT COUNT(*) FROM rd38_playwright_falhas WHERE detectado_em > NOW() - INTERVAL '24 hours'),
    'pendentes', (SELECT COUNT(*) FROM rd38_playwright_falhas WHERE status = 'novo'),
    'throttle_vercel', (SELECT COUNT(*) FROM rd38_playwright_falhas WHERE status = 'throttle_vercel'),
    'tipos_erro', COALESCE((
      SELECT jsonb_object_agg(tipo_erro, qtd) FROM (
        SELECT tipo_erro, COUNT(*) AS qtd FROM rd38_playwright_falhas
        WHERE detectado_em > NOW() - INTERVAL '24 hours'
        GROUP BY tipo_erro
      ) t
    ), '{}'::jsonb)
  ) INTO v_rd38_falhas_playwright;

  -- RD-38 NOVO: falhas cron
  SELECT jsonb_build_object(
    'total_1h', (SELECT COUNT(*) FROM rd38_cron_falhas WHERE detectado_em > NOW() - INTERVAL '1 hour'),
    'pendentes', (SELECT COUNT(*) FROM rd38_cron_falhas WHERE status = 'novo'),
    'jobs_quebrados', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'jobname', jobname,
        'qtd_falhas', qtd,
        'tipo_erro', tipo_erro,
        'falhas_consecutivas', max_consec
      ) ORDER BY qtd DESC)
      FROM (
        SELECT jobname, tipo_erro, COUNT(*) AS qtd, MAX(falhas_consecutivas) AS max_consec
        FROM rd38_cron_falhas
        WHERE detectado_em > NOW() - INTERVAL '1 hour'
        GROUP BY jobname, tipo_erro
      ) t
    ), '[]'::jsonb)
  ) INTO v_rd38_falhas_cron;

  v_result := jsonb_build_object(
    'momento', NOW(),
    'aviso_rd35', 'RD-35 + CONTRATO V1 + PLANO SANEAMENTO V1 + RD-38 + RD-39 INEGOCIAVEIS.',
    'contrato_v1', v_contrato_v1_ativo,
    'plano_saneamento_v1', v_saneamento,

    'rd38_doutrina_verdade_absoluta', jsonb_build_object(
      'vigente_desde', '24/05/2026',
      'principio_raiz', 'Engenheiro Chefe NUNCA pode declarar entrega validada baseado em ausencia de evidencia negativa. Verdade absoluta exige confronto entre PROMETIDO vs REAL.',
      'bloqueio_ativo', 'Nenhum PR feature pode ser declarado validado sem CEO confirmar empiricamente · ate Camada 1 estar em producao',
      'camadas_status', jsonb_build_object(
        'camada_1_url_final_visitada', 'pendente_pr_repo',
        'camada_2_fn_validar_entrega_pr', 'v1_manual_em_producao',
        'camada_3_insight_nao_silent', 'em_producao',
        'camada_3_expandida_playwright_falhas', 'em_producao',
        'camada_3_estendida_cron_falhas', 'em_producao',
        'camada_4_briefing_entregas', 'em_producao'
      ),
      'validacao_prs_72h', v_rd38_validacao_prs,
      'rejeicoes_insight', v_rd38_rejeicoes_insight,
      'falhas_playwright', v_rd38_falhas_playwright,
      'falhas_cron', v_rd38_falhas_cron
    ),

    'alertas_pendentes_para_ceo', jsonb_build_object(
      'truth_alerts_criticos', COALESCE(v_truth_pendentes,'[]'::jsonb),
      'truth_alerts_total_pendentes', (SELECT COUNT(*) FROM erp_truth_alerts WHERE status='novo' AND severity IN ('critical','high')),
      'insights_ui_criticos', COALESCE(v_insights_pendentes,'[]'::jsonb),
      'insights_ui_total_pendentes', (SELECT COUNT(*) FROM system_screens_insights WHERE (apresentado_ceo=false OR apresentado_ceo IS NULL) AND (score_evolucao_pct<30 OR score_visual<30)),
      'telas_em_loop_refacao', COALESCE(v_telas_refacao,'[]'::jsonb),
      'instrucao_claude', 'OBRIGATORIO Secao 1.5 Contrato V1 + DECLARAR Fase atual Saneamento + RD-38 verificar entregas pendentes + falhas Playwright/cron'
    ),
    'estrela_polar_resumo', jsonb_build_object(
      'aviso', 'Secoes 1, 2, 6, 7, 8 + Secao 9 Contrato V1 + Secao 10 Saneamento V1 + Regra 35 + RD-38 + RD-39',
      'secao_1_visao', jsonb_build_object('versao','V1.7','planos_total',12,'lancamento_erp_completo','2027-05'),
      'secao_2_regras', jsonb_build_object('regra_34','Eficiencia + Integridade + Velocidade','regra_35','IPO obrigatoria 4 fontes','regra_38','Doutrina Verdade Absoluta','regra_39','Zero Handoff'),
      'secao_6_comunicacao', jsonb_build_object('versao','V1.1','filtro_7_itens',ARRAY['Land/Expand/Replace','Foundational 10K','ERP 2027','Camada arquitetural','Legal','LGPD','UX mobile-first']),
      'secao_7_autonomia', jsonb_build_object('5_cenarios','A executa+reporta / B executa+justifica / C 6 grupos protegidos PARA / D alerta violacao / E para+pergunta'),
      'secao_8_olhos_maos', jsonb_build_object('fase_a','Visual Truth Auditor em construcao'),
      'secao_9_contrato_v1', jsonb_build_object('vigente_desde','16/05/2026','protocolo','sintese 3 linhas obrigatoria + anti-refacao'),
      'secao_10_saneamento_v1', jsonb_build_object('vigente_desde','16/05/2026','fases_sequenciais',true,'conclusao_estimada','13/06/2026'),
      'regra_35_ipo', jsonb_build_object('versao','V1.0','gatilhos',ARRAY['cliente operando','pacote >2h','CEO sinaliza','404/erro']),
      'regra_38_verdade_absoluta', jsonb_build_object('versao','V1.0','vigente_desde','24/05/2026','camadas',4),
      'regra_39_zero_handoff', jsonb_build_object('versao','V1.0','vigente_desde','24/05/2026','principio','Eng Chefe NUNCA propoe pausa')
    ),
    'checklist_obrigatoria_claude', jsonb_build_object(
      'itens', ARRAY[
        '1. Li resumo Estrela Polar?',
        '2. Apliquei Filtro 7 itens?',
        '3. Qual Cenario Sec 7?',
        '4. Toca 6 Grupos Protegidos?',
        '5. Avaliei Regra #34?',
        '6. Vou cristalizar?',
        '7. Gatilhos Regra #35 IPO?',
        '8. Visual_truth alertas?',
        '9. ⭐ CONTRATO V1: sintese 3 linhas (Sec 1.5)?',
        '10. ⭐ CONTRATO V1: rota em LOOP DE REFACAO? Justificar?',
        '11. 🛑 SANEAMENTO V1: estamos em qual Fase? Minha proposta cabe na Fase atual?',
        '12. 🛑 SANEAMENTO V1: meu PR cita "Fase X.Y" no body?',
        '13. 🛑 SANEAMENTO V1: feature NOVA está proibida (exceto Fase 4)?',
        '14. 🛡️ RD-38: PR mergeado validado empiricamente pelo CEO ou apenas via auditor (potencial falso-positivo)?',
        '15. 🛡️ RD-39: ZERO handoff · NUNCA propor pausa',
        '16. 🛡️ RD-38: Falhas Playwright/cron pendentes? Verificar bloco rd38_doutrina_verdade_absoluta no briefing'
      ]
    ),
    'ultimo_handoff', CASE WHEN v_ultimo_handoff.id IS NOT NULL THEN jsonb_build_object('sessao_data',v_ultimo_handoff.sessao_data,'ha_horas',EXTRACT(EPOCH FROM (NOW()-v_ultimo_handoff.criado_em))::int/3600,'ultima_acao',v_ultimo_handoff.ultima_acao,'ultimo_pr',v_ultimo_handoff.ultimo_pr,'proxima_acao_recomendada',v_ultimo_handoff.proxima_acao_recomendada,'alertas_criticos',v_ultimo_handoff.alertas_criticos) ELSE jsonb_build_object('aviso','PRIMEIRA SESSAO') END,
    'visual_truth', fn_visual_truth_resumo(),
    'manual_vivo_ultimo_snapshot', CASE WHEN v_ultimo_snapshot.id IS NOT NULL THEN jsonb_build_object('data',v_ultimo_snapshot.data_snapshot,'pct_evolucao_geral',v_ultimo_snapshot.pct_evolucao_geral,'rotas_404',v_ultimo_snapshot.rotas_404_confirmadas,'telas_score_critico',v_ultimo_snapshot.telas_score_critico) ELSE jsonb_build_object('aviso','sem snapshot') END,
    'empresas_resumo', (SELECT jsonb_build_object('total',COUNT(*),'ativas',COUNT(*) FILTER (WHERE is_active=true),'nota','produção; demos e sandboxes fora') FROM companies_producao),
    'comercial', (SELECT jsonb_build_object('clientes_ativos',COUNT(*) FILTER (WHERE ts.status='active'),'mrr_total_brl',COALESCE(SUM(ts.monthly_price_brl) FILTER (WHERE ts.status='active'),0)) FROM tenant_subscriptions ts JOIN plan_catalog pc ON pc.id=ts.plan_id AND pc.legacy=false WHERE ts.company_id IN (SELECT fn_empresas_produtivas())),
    'auditores_status', (SELECT jsonb_agg(jsonb_build_object('jobname',jobname,'active',active)) FROM cron.job WHERE jobname LIKE '%auditor%' OR jobname LIKE '%watcher%' OR jobname LIKE '%insight%' OR jobname LIKE '%manual_vivo%' OR jobname LIKE '%playwright%')
  );

  v_result := v_result || jsonb_build_object('fluxo_trabalho_oficial_RD41', fn_fluxo_trabalho_oficial());
  v_result := v_result || jsonb_build_object(
    'estado_construcao_ge', (
      SELECT jsonb_build_object(
        'trilha', 'GE · Rodar como ContaAzul (custo zero)',
        'blocos_total', COUNT(*),
        'blocos_concluidos', COUNT(*) FILTER (WHERE status = 'concluido'),
        'pct', CASE WHEN COUNT(*)>0 THEN ROUND(100.0*COUNT(*) FILTER (WHERE status='concluido')/COUNT(*)) ELSE 0 END,
        'proximo_bloco', (SELECT titulo FROM erp_roadmap_marcos WHERE trilha_nome = 'GE · Rodar como ContaAzul (custo zero)' AND status != 'concluido' ORDER BY ordem_na_trilha LIMIT 1),
        'como_marcar_avanco', 'SELECT fn_registrar_avanco_ge(marco_id, pr, print_url, veredito_gold, nota)'
      )
      FROM erp_roadmap_marcos
      WHERE trilha_nome = 'GE · Rodar como ContaAzul (custo zero)'
    )
  );

  -- ADITIVO (RD-52): fontes externas para a próxima Claude — verdade do coletor ATAK/Frioeste no briefing.
  v_result := v_result || jsonb_build_object('fontes_externas', jsonb_build_object('atak', public.fn_atak_status()));

  v_result := v_result || jsonb_build_object('chamados_envelhecidos_sem_pr', public.fn_chamados_envelhecidos_sem_pr());

  -- ================= ALERTA DE VALIDADE DE CERTIFICADOS (CEO 24/09/2026) =================
  -- A1 fiscal (erp_certificados_a1.validade_fim) + comunicação bancária (erp_banco_provider_config.cert_expira_em).
  -- Escalonado: 30d só no bloco alertas_certificados; ≤7d/vencido também em alertas_pendentes_para_ceo.
  WITH certs AS (
    SELECT 'a1_fiscal'::text AS tipo,
           COALESCE(comp.nome_fantasia, c.razao_social_certificado) AS empresa,
           c.razao_social_certificado AS detalhe,
           c.validade_fim AS validade,
           (c.validade_fim - current_date) AS dias
    FROM public.erp_certificados_a1 c
    LEFT JOIN public.companies comp ON comp.id = c.company_id
    WHERE c.removido_em IS NULL AND c.validade_fim IS NOT NULL
    UNION ALL
    SELECT 'comunicacao_bancaria'::text AS tipo,
           COALESCE(comp.nome_fantasia, pc.provider) AS empresa,
           (pc.provider || ' ' || pc.banco_codigo || ' (' || pc.ambiente || ')') AS detalhe,
           pc.cert_expira_em AS validade,
           (pc.cert_expira_em - current_date) AS dias
    FROM public.erp_banco_provider_config pc
    LEFT JOIN public.companies comp ON comp.id = pc.company_id
    WHERE pc.cert_expira_em IS NOT NULL AND pc.ativo = true
  )
  SELECT
    jsonb_build_object(
      'gerado_em', now(),
      'regra', '30d→briefing; 7d→+alertas_pendentes_para_ceo; vencido→alertas_pendentes_para_ceo até resolver. Quem renova é contador/cliente.',
      'total_monitorados', (SELECT count(*) FROM certs),
      'proximos_ou_vencidos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'tipo', tipo, 'empresa', empresa, 'detalhe', detalhe, 'validade', validade, 'dias_para_vencer', dias,
          'tier', CASE WHEN dias < 0 THEN 'vencido' WHEN dias <= 7 THEN 'critico_7d' ELSE 'aviso_30d' END
        ) ORDER BY dias ASC)
        FROM certs WHERE dias <= 30
      ), '[]'::jsonb)
    ),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'tipo', tipo, 'empresa', empresa, 'detalhe', detalhe, 'validade', validade, 'dias_para_vencer', dias,
        'tier', CASE WHEN dias < 0 THEN 'vencido' ELSE 'critico_7d' END,
        'acao', CASE WHEN tipo='a1_fiscal' THEN 'Renovar certificado A1 (contador/cliente) — vencido BLOQUEIA emissão fiscal'
                     ELSE 'Renovar certificado de comunicação bancária — vencido DERRUBA a integração' END
      ) ORDER BY dias ASC)
      FROM certs WHERE dias <= 7
    ), '[]'::jsonb)
  INTO v_alertas_certificados, v_certs_criticos;

  v_result := v_result || jsonb_build_object('alertas_certificados', v_alertas_certificados);
  -- só insere a chave quando há crítico → sem crítico, alertas_pendentes_para_ceo sai IDÊNTICO ao de hoje.
  IF jsonb_array_length(v_certs_criticos) > 0 THEN
    v_result := jsonb_set(v_result, '{alertas_pendentes_para_ceo,certificados_criticos}', v_certs_criticos, true);
  END IF;

  RETURN v_result;
END;
$function$;

-- Guardas (check-fn-guards): SECURITY DEFINER fechada ao anon. Sem autoria por parâmetro (fn read-only).
REVOKE ALL ON FUNCTION public.fn_briefing_sessao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_briefing_sessao() TO authenticated, service_role;
