-- Decisão do CEO (30/09): a demonstração Comércio (GE) passa a incluir a área Hub (/dashboard/projetos).
-- Sem uma demo com Hub, as telas de obras/oportunidades/propostas nunca eram testadas na aceitação: o AreaRedirectGuard
-- tirava o robô de /dashboard/projetos (Resultado por obra da FC, oportunidades e anexos da Tryo, #263).
--   1) Assinatura v15_hub_t1 na demo GE: ativa, R$ 0, fora do MRR (fn_empresas_produtivas exclui demos). Mesmo padrão
--      do GE Pró (20260926300000). O fn_demo_reset não mexe em tenant_subscriptions — a área sobrevive ao reset.
--   2) demo_por_area('hub') = demo GE (crons do juiz/vigia e o briefing sabem qual demo exercita o Hub).
--   3) Briefing: nova chave 'demos' (área → empresa de demonstração e planos ativos), lida de demo_por_area.
--   4) Decisão registrada em erp_contexto_projeto.
-- SÓ DEMONSTRAÇÃO: guarda por is_demo; nenhuma empresa real muda.

DO $$
DECLARE c constant uuid := 'b0700000-0000-4000-a000-000000000004';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = c AND is_demo IS TRUE) THEN
    RAISE EXCEPTION 'Comércio (GE) - DEMO não existe ou não é demo — migration abortada';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_subscriptions WHERE company_id = c AND plan_id = 'v15_hub_t1') THEN
    UPDATE public.tenant_subscriptions SET status = 'active', monthly_price_brl = 0, updated_at = now()
     WHERE company_id = c AND plan_id = 'v15_hub_t1'
       AND (status IS DISTINCT FROM 'active' OR monthly_price_brl IS DISTINCT FROM 0);
  ELSE
    INSERT INTO public.tenant_subscriptions (company_id, plan_id, status, monthly_price_brl, billing_cycle, tier, observacao)
    VALUES (c, 'v15_hub_t1', 'active', 0, 'monthly', 'T1', 'Demonstração · decisão CEO 30/09 (demo GE inclui Hub)');
  END IF;

  INSERT INTO public.demo_por_area (area, company_id) VALUES ('hub', c)
  ON CONFLICT (area) DO UPDATE SET company_id = EXCLUDED.company_id;

  IF NOT EXISTS (SELECT 1 FROM public.erp_contexto_projeto WHERE titulo LIKE 'Demo GE inclui a área Hub%') THEN
    INSERT INTO public.erp_contexto_projeto (projeto, categoria, prioridade, status, titulo, descricao, tags, criado_por)
    VALUES ('erp-psgestao', 'decisao', 'alta', 'ativo',
      'Demo GE inclui a área Hub (CEO 30/09)',
      'A demonstração Comércio (GE, b0700000-…-0004) tem o plano v15_hub_t1 (R$ 0, fora do MRR) e é a demo_por_area do Hub. '
      || 'Testes de aceitação de /dashboard/projetos (obras, oportunidades, propostas) rodam nela. Migration 20260930170000.',
      ARRAY['demo','hub','decisao-ceo','aceitacao'], 'claude-sessao');
  END IF;
END $$;

-- Briefing: chave 'demos'. Troca pontual e verificada (a chave 'empresas_resumo' aparece uma vez só).
DO $$
DECLARE v_def text; v_novo text;
  v_ancora constant text := '''empresas_resumo'', (SELECT';
  v_demos  constant text := '''demos'', (SELECT jsonb_object_agg(d.area, jsonb_build_object(''company_id'', d.company_id, '
    || '''empresa'', c.nome_fantasia, ''planos_ativos'', (SELECT jsonb_agg(ts.plan_id ORDER BY ts.plan_id) FROM tenant_subscriptions ts '
    || 'WHERE ts.company_id = d.company_id AND ts.status = ''active''))) FROM demo_por_area d JOIN companies c ON c.id = d.company_id),'
    || E'\n    ';
BEGIN
  v_def := pg_get_functiondef('public.fn_briefing_sessao()'::regprocedure);
  IF position('''demos''' IN v_def) > 0 THEN
    RAISE NOTICE 'fn_briefing_sessao já tem a chave demos — nada a fazer';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 THEN
    RAISE EXCEPTION 'fn_briefing_sessao: âncora ''empresas_resumo'' não encontrada exatamente uma vez — revisar a migration';
  END IF;
  v_novo := replace(v_def, v_ancora, v_demos || v_ancora);
  EXECUTE v_novo;
END $$;
