-- Auditor · fn_auditor_matriz_disparar ganha modo DRY-RUN (p_dry_run) — teste NÃO consome API paga
--
-- Provado (31/10): o spec e2e e2e/jornadas/aceitacao/auditor-matriz-conserto.spec.ts chamava fn_auditor_matriz_disparar
-- de VERDADE em PRODUÇÃO a cada execução da suíte (82x em 48h → 930 análises pagas + 206 erros, ~US$75 de um teto de
-- US$150/mês), estourando o orçamento e congelando as notas. O custo vem de fn_auditor_disparar (Playwright + IA).
--
-- Conserto: um modo DRY-RUN que valida o CONSERTO (RD-69/70: empresa não-demo → demo, observação, rota_completa com a
-- demo) SEM acionar a IA: cria o run, faz a troca de empresa e monta as rotas, mas NÃO chama fn_auditor_disparar nem
-- grava resultado (request_id_insight jamais é criado). Em produção (p_dry_run=false, padrão) o comportamento é
-- IDÊNTICO ao de hoje. Como o parâmetro muda a assinatura, faz-se DROP + CREATE preservando os grants (postgres,
-- service_role) e o REVOKE de anon.

DROP FUNCTION IF EXISTS public.fn_auditor_matriz_disparar(text, uuid, text[], text[], text);

CREATE OR REPLACE FUNCTION public.fn_auditor_matriz_disparar(
  p_area_id text,
  p_company_id uuid DEFAULT NULL::uuid,
  p_apenas_status text[] DEFAULT ARRAY['pronto'::text, 'parcial'::text],
  p_modulos_filter text[] DEFAULT NULL::text[],
  p_observacao text DEFAULT NULL::text,
  p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id BIGINT;
  v_modulo RECORD;
  v_rota_completa TEXT;
  v_rota_base TEXT;
  v_disparado JSONB;
  v_total INTEGER := 0;
  v_rotas_disparadas JSONB := '[]'::JSONB;
  v_status text[] := COALESCE(p_apenas_status, ARRAY['pronto','parcial']);
  v_empresa uuid;
  v_obs text := p_observacao;
  v_area_tela text;
BEGIN
  -- só service_role/cron (sem usuário) ou administrador da PS
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'sem permissão para disparar o auditor' USING ERRCODE = '42501';
  END IF;

  -- marca o run de teste para rastro (sem custo): o DRY-RUN não chama IA
  IF p_dry_run THEN
    v_obs := concat_ws(' · ', v_obs, 'dry-run (sem IA, sem custo)');
  END IF;

  -- RD-69/70 (LGPD): o robô só fotografa empresa de demonstração. Empresa pedida que não é demo → demo da área.
  IF p_company_id IS NOT NULL AND EXISTS (SELECT 1 FROM companies c WHERE c.id = p_company_id AND c.is_demo) THEN
    v_empresa := p_company_id;
  ELSE
    v_empresa := public.fn_demo_da_area(p_area_id);
    IF p_company_id IS NOT NULL THEN
      v_obs := concat_ws(' · ', v_obs, format('empresa pedida %s não é de demonstração (RD-69/70) → auditado na demo %s',
                                              p_company_id, COALESCE(v_empresa::text, '(nenhuma demo para a área)')));
    END IF;
  END IF;

  INSERT INTO erp_auditor_matriz_runs (area_id, company_id, modo, filtro_status, observacao, trigger_origin, user_id)
  VALUES (p_area_id, v_empresa, CASE WHEN p_dry_run THEN 'dry_run' ELSE 'manual' END, v_status, v_obs, 'fn_auditor_matriz_disparar', auth.uid())
  RETURNING id INTO v_run_id;

  FOR v_modulo IN
    WITH modulos_distintos AS (
      SELECT DISTINCT ON (m.modulo_id) m.modulo_id, m.nome, m.rota, m.status, m.ordem
      FROM fn_modulos_sidebar_por_area(p_area_id) m
      WHERE ('todos' = ANY(v_status) OR m.status = ANY(v_status) OR (m.status IS NULL AND 'sem_status' = ANY(v_status)))
        AND m.rota IS NOT NULL
        AND m.rota NOT LIKE '%#%'
        AND (p_modulos_filter IS NULL OR m.modulo_id = ANY(p_modulos_filter))
    )
    SELECT modulo_id, nome, rota, status FROM modulos_distintos ORDER BY ordem
  LOOP
    v_rota_base := SPLIT_PART(v_modulo.rota, '?', 1);
    v_rota_completa := v_modulo.rota;
    IF v_empresa IS NOT NULL THEN
      v_rota_completa := v_rota_completa || CASE WHEN v_rota_completa LIKE '%?%' THEN '&' ELSE '?' END
                         || 'company_id=' || v_empresa::text;
    END IF;

    -- DRY-RUN: valida a troca/rota SEM cadastrar tela, sem disparar IA e sem gravar resultado (zero custo).
    IF p_dry_run THEN
      v_total := v_total + 1;
      v_rotas_disparadas := v_rotas_disparadas || jsonb_build_object(
        'modulo_id', v_modulo.modulo_id, 'nome', v_modulo.nome, 'rota_completa', v_rota_completa, 'dry_run', true);
      CONTINUE;
    END IF;

    -- área sem demo: não dispara (o robô recusaria) — registra como não auditável
    IF v_empresa IS NULL THEN
      INSERT INTO erp_auditor_matriz_resultados (run_id, modulo_id, modulo_nome, rota_base, rota_completa,
        status_modulo_catalogo, t0_dispatch, status, bugs_detectados)
      VALUES (v_run_id, v_modulo.modulo_id, v_modulo.nome, v_rota_base, v_rota_completa, v_modulo.status, NOW(), 'erro',
        ARRAY['não auditável: a área "' || p_area_id || '" não tem empresa de demonstração (RD-69/70)']::TEXT[])
      ON CONFLICT (run_id, modulo_id) DO NOTHING;
      CONTINUE;
    END IF;

    BEGIN
      -- tela ainda não cadastrada: cadastra com a área (fn_auditor_disparar cadastraria sem "area" e quebraria)
      IF NOT EXISTS (SELECT 1 FROM system_screens s WHERE s.rota = v_rota_base) THEN
        SELECT s.area INTO v_area_tela FROM system_screens s
        WHERE v_rota_base LIKE s.rota || '/%' AND s.area IS NOT NULL
        ORDER BY length(s.rota) DESC LIMIT 1;
        INSERT INTO system_screens (id, rota, area, titulo, estado_real, prioridade_monitoramento)
        VALUES (REGEXP_REPLACE(TRIM(LEADING '/' FROM v_rota_base), '/', '.', 'g'), v_rota_base,
                COALESCE(v_area_tela, p_area_id), COALESCE(NULLIF(v_modulo.nome, ''), v_rota_base),
                'desconhecida', 'alta')
        ON CONFLICT DO NOTHING;
      END IF;

      v_disparado := fn_auditor_disparar(v_rota_completa);
      IF COALESCE((v_disparado->>'sucesso')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION '%', COALESCE(v_disparado->>'erro', 'disparo sem sucesso');
      END IF;

      INSERT INTO erp_auditor_matriz_resultados (run_id, modulo_id, modulo_nome, rota_base, rota_completa,
        screen_id, status_modulo_catalogo, t0_dispatch, status, request_id_playwright, request_id_insight)
      VALUES (v_run_id, v_modulo.modulo_id, v_modulo.nome, v_rota_base, v_rota_completa,
        v_disparado->>'screen_id', v_modulo.status, (v_disparado->>'t0')::TIMESTAMPTZ, 'pending',
        (v_disparado#>>'{request_id_playwright}')::BIGINT, (v_disparado#>>'{insight_dispatch,request_id}')::BIGINT)
      ON CONFLICT (run_id, modulo_id) DO NOTHING;

      v_total := v_total + 1;
      v_rotas_disparadas := v_rotas_disparadas || jsonb_build_object(
        'modulo_id', v_modulo.modulo_id, 'nome', v_modulo.nome, 'rota_completa', v_rota_completa, 't0', v_disparado->>'t0');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO erp_auditor_matriz_resultados (run_id, modulo_id, modulo_nome, rota_base, rota_completa,
        status_modulo_catalogo, t0_dispatch, status, bugs_detectados)
      VALUES (v_run_id, v_modulo.modulo_id, v_modulo.nome, v_rota_base, v_rota_completa,
        v_modulo.status, NOW(), 'erro', ARRAY['Erro ao disparar: ' || SQLERRM]::TEXT[])
      ON CONFLICT (run_id, modulo_id) DO NOTHING;
    END;
  END LOOP;

  UPDATE erp_auditor_matriz_runs
  SET total_modulos = (SELECT count(*) FROM erp_auditor_matriz_resultados WHERE run_id = v_run_id),
      resultados_processando = v_total,
      resultados_falharam = (SELECT count(*) FROM erp_auditor_matriz_resultados WHERE run_id = v_run_id AND status = 'erro'),
      custo_estimado_usd = (CASE WHEN p_dry_run THEN 0 ELSE v_total * 0.013 END)::NUMERIC(5,4)
  WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'run_id', v_run_id, 'area_id', p_area_id, 'company_id', v_empresa, 'company_id_pedida', p_company_id,
    'observacao', v_obs, 'total_disparados', v_total, 'dry_run', p_dry_run,
    'custo_estimado_usd', (CASE WHEN p_dry_run THEN 0 ELSE v_total * 0.013 END),
    'rotas_disparadas', v_rotas_disparadas, 'iniciado_em', NOW(),
    'instrucao', CASE WHEN p_dry_run THEN 'dry-run: nenhuma análise paga foi disparada'
                      ELSE 'O cron consulta a cada 5 min; para ver já: fn_auditor_matriz_consultar(' || v_run_id || ')' END);
END $function$;

REVOKE ALL ON FUNCTION public.fn_auditor_matriz_disparar(text, uuid, text[], text[], text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_auditor_matriz_disparar(text, uuid, text[], text[], text, boolean) TO postgres, service_role;
