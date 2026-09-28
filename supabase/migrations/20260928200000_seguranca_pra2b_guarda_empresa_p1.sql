-- 🚨 SEGURANÇA · PR A2b parte 1 (CEO 28/09) — funções de TELA que gravam na empresa recebida por parâmetro sem
-- conferir se ela é do usuário. SECURITY DEFINER pula a RLS: qualquer logado passava o company_id de outra empresa e
-- gravava/apagava lá (balanço, bens, DRE, calendário de compliance, importações, obra, orçamento de linha de negócio,
-- custo agro, plano de contas, projetos, credenciais do cofre, fila de sync...).
--
-- Guarda (inserida logo após o BEGIN): sem usuário (serviço/cron/gatilho de sistema) passa; logado precisa ser admin PS
-- ou a empresa estar em get_user_company_ids() (a mesma regra da RLS). Empresa NULL: só admin — exceto
-- fn_sugestao_criar (chamado pode ser aberto sem empresa selecionada).
-- As 23 são plpgsql, 1 assinatura cada; lista do levantamento A2 (scratchpad pra2_classificacao.md, lista 2).
-- A parte 2 (≈21 que recebem o ID do registro e precisam descobrir a empresa) vem em seguida.

DO $do$
DECLARE r record; v_oid oid; v_def text; v_new text; v_pos int; v_marker text; v_guarda text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('fn_alertas_gerar_automaticos','p_company_id'),
    ('fn_autoclassificar_produtos','p_company_id'),
    ('fn_balanco_copiar_periodo','p_company_id'),
    ('fn_balanco_linha_excluir','p_company_id'),
    ('fn_balanco_linha_salvar','p_company_id'),
    ('fn_bem_baixar','p_company_id'),
    ('fn_bem_calcular_depreciacao','p_company_id'),
    ('fn_compliance_calendar_gerar_de_documentos','p_company_id'),
    ('fn_compliance_calendar_gerar_recorrentes_mensais','p_company_id'),
    ('fn_credencial_salvar_sistema','p_company_id'),
    ('fn_dre_ordem_personalizada_reset','p_company_id'),
    ('fn_dre_ordem_personalizada_set','p_company_id'),
    ('fn_hub_criar_obra_rapida','p_company_id'),
    ('fn_import_produtos_fiscal','p_company_id'),
    ('fn_import_universal_dispatch','p_company_id'),
    ('fn_ldn_aplicar_budget_anual','p_company_id'),
    ('fn_outbox_enfileirar','p_company_id'),
    ('fn_pec_custo_importar_do_pagar','p_company'),
    ('fn_pec_custo_ratear','p_company'),
    ('fn_plano_contas_aplicar_sugestoes_padrao','p_company_id'),
    ('fn_projetos_aplicar_preset_bdi','p_company_id'),
    ('fn_projetos_importar_catalogo_publico','p_company_id'),
    ('fn_sugestao_criar','p_company_id')) AS t(fn, param)
  LOOP
    SELECT p.oid INTO v_oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.fn;
    IF v_oid IS NULL THEN RAISE NOTICE 'PR A2b: % não existe — pulando', r.fn; CONTINUE; END IF;
    v_def := pg_get_functiondef(v_oid);
    IF v_def ~ 'PR A2b \(CEO 28/09\)' THEN CONTINUE; END IF;
    v_guarda := E'\n  -- PR A2b (CEO 28/09): a empresa tem de ser do usuário (sem usuário = serviço/cron passa)\n'
      || E'  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND '
      || CASE WHEN r.fn = 'fn_sugestao_criar'
              THEN format('%1$s IS NOT NULL AND %1$s NOT IN (SELECT public.get_user_company_ids())', r.param)
              ELSE format('(%1$s IS NULL OR %1$s NOT IN (SELECT public.get_user_company_ids()))', r.param) END
      || E' THEN\n    RAISE EXCEPTION ''Sem acesso a esta empresa'' USING ERRCODE = ''42501'';\n  END IF;\n';
    v_marker := substring(v_def from '\nAS (\$[a-z_]*\$)');
    v_pos := strpos(v_def, E'\nAS ' || v_marker);
    IF v_pos = 0 THEN RAISE EXCEPTION 'PR A2b: corpo não encontrado em %', r.fn; END IF;
    v_new := substr(v_def, 1, v_pos) || regexp_replace(substr(v_def, v_pos + 1), '(\mBEGIN\M)', E'\\1' || v_guarda, 'i');
    IF v_new = v_def THEN RAISE EXCEPTION 'PR A2b: BEGIN não encontrado em %', r.fn; END IF;
    EXECUTE v_new;
  END LOOP;
END $do$;

-- trava: todas com a guarda
DO $$
DECLARE v text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('fn_alertas_gerar_automaticos', 'fn_autoclassificar_produtos', 'fn_balanco_copiar_periodo', 'fn_balanco_linha_excluir', 'fn_balanco_linha_salvar', 'fn_bem_baixar', 'fn_bem_calcular_depreciacao', 'fn_compliance_calendar_gerar_de_documentos', 'fn_compliance_calendar_gerar_recorrentes_mensais', 'fn_credencial_salvar_sistema', 'fn_dre_ordem_personalizada_reset', 'fn_dre_ordem_personalizada_set', 'fn_hub_criar_obra_rapida', 'fn_import_produtos_fiscal', 'fn_import_universal_dispatch', 'fn_ldn_aplicar_budget_anual', 'fn_outbox_enfileirar', 'fn_pec_custo_importar_do_pagar', 'fn_pec_custo_ratear', 'fn_plano_contas_aplicar_sugestoes_padrao', 'fn_projetos_aplicar_preset_bdi', 'fn_projetos_importar_catalogo_publico', 'fn_sugestao_criar')
     AND pg_get_functiondef(p.oid) !~ 'PR A2b \(CEO 28/09\)';
  IF v IS NOT NULL THEN RAISE EXCEPTION 'PR A2b: sem guarda de empresa: %', v; END IF;
END $$;
