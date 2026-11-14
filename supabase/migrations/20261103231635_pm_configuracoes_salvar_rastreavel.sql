-- PDCA P&M · /dashboard/pm/configuracoes — RD-98 p4: persistência (Salvar) NÃO era rastreável
--
-- CAUSA-RAIZ (RD-38, provado no dado): duas abas gravavam por ESCRITA DIRETA do cliente, sem audit_log_global:
--   • Alertas e prazos  → supabase.from('crm_alerta_config').update/insert (page.tsx salvar())
--   • Proposta          → supabase.from('agency_proposta_config').upsert (page.tsx salvar())
--   (As abas Funil e Listas já salvam por RPC: fn_funil_etapa_salvar / fn_agency_config_salvar.)
--   Tabelas (RLS por empresa, company_id IN get_user_company_ids()):
--     crm_alerta_config (uq company_id,funil,COALESCE(etapa,'')); agency_proposta_config (PK company_id, validade_dias default 15).
--
-- ESTA MIGRATION (ADITIVA — 2 funções NOVAS; nenhuma tabela/RLS/policy alterada):
--   fn_pm_config_alertas_salvar  / fn_pm_config_proposta_salvar — SECURITY DEFINER, exigem auth.uid(),
--   conferem empresa (get_user_company_ids OR is_admin), validam e gravam audit_log_global (quem/quando/antes/depois).
--   A tela passa a chamar essas RPCs em vez da escrita direta. REVOKE anon; GRANT só authenticated/service_role.

CREATE OR REPLACE FUNCTION public.fn_pm_config_alertas_salvar(p_company_id uuid, p_dias_amarelo integer, p_dias_vermelho integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_ant_a integer; v_ant_v integer;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para salvar'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_dias_amarelo IS NULL OR p_dias_vermelho IS NULL OR p_dias_amarelo < 1 OR p_dias_vermelho < 1 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'prazos_minimo_1'); END IF;
  IF p_dias_vermelho < p_dias_amarelo THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'vermelho_menor_que_amarelo'); END IF;

  SELECT id, dias_amarelo, dias_vermelho INTO v_id, v_ant_a, v_ant_v
    FROM public.crm_alerta_config
   WHERE company_id = p_company_id AND funil = 'leads' AND etapa IS NULL
   FOR UPDATE;

  IF v_id IS NULL THEN
    INSERT INTO public.crm_alerta_config (company_id, funil, etapa, dias_amarelo, dias_vermelho)
      VALUES (p_company_id, 'leads', NULL, p_dias_amarelo, p_dias_vermelho)
      RETURNING id INTO v_id;
  ELSE
    UPDATE public.crm_alerta_config
       SET dias_amarelo = p_dias_amarelo, dias_vermelho = p_dias_vermelho, atualizado_em = now()
     WHERE id = v_id;
  END IF;

  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (p_company_id, v_uid, 'crm_alerta_config', v_id, 'salvar',
            jsonb_build_object('dias_amarelo', v_ant_a, 'dias_vermelho', v_ant_v),
            jsonb_build_object('dias_amarelo', p_dias_amarelo, 'dias_vermelho', p_dias_vermelho));
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_pm_config_proposta_salvar(p_company_id uuid, p_exigir boolean, p_condicao text, p_desconto_max numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_ant jsonb; v_cond text; v_desc numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para salvar'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_desconto_max IS NOT NULL AND (p_desconto_max < 0 OR p_desconto_max > 100) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'desconto_fora_de_0_a_100'); END IF;
  v_cond := NULLIF(btrim(coalesce(p_condicao, '')), '');
  v_desc := p_desconto_max;

  SELECT jsonb_build_object('exigir_item_catalogo', exigir_item_catalogo, 'condicao_padrao', condicao_padrao, 'desconto_max_pct', desconto_max_pct)
    INTO v_ant FROM public.agency_proposta_config WHERE company_id = p_company_id FOR UPDATE;

  INSERT INTO public.agency_proposta_config (company_id, exigir_item_catalogo, condicao_padrao, desconto_max_pct, atualizado_em)
    VALUES (p_company_id, coalesce(p_exigir, false), v_cond, v_desc, now())
  ON CONFLICT (company_id) DO UPDATE
    SET exigir_item_catalogo = EXCLUDED.exigir_item_catalogo,
        condicao_padrao      = EXCLUDED.condicao_padrao,
        desconto_max_pct     = EXCLUDED.desconto_max_pct,
        atualizado_em        = now();

  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (p_company_id, v_uid, 'agency_proposta_config', p_company_id, 'salvar',
            coalesce(v_ant, '{}'::jsonb),
            jsonb_build_object('exigir_item_catalogo', coalesce(p_exigir, false), 'condicao_padrao', v_cond, 'desconto_max_pct', v_desc));
  RETURN jsonb_build_object('ok', true, 'company_id', p_company_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_pm_config_alertas_salvar(uuid, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_pm_config_proposta_salvar(uuid, boolean, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_config_alertas_salvar(uuid, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_pm_config_proposta_salvar(uuid, boolean, text, numeric) TO authenticated, service_role;

-- RD-98 p3: registra as RPCs novas como origem do dado da tela
UPDATE public.system_screens
   SET rpcs_chamadas = (
     SELECT array_agg(DISTINCT x ORDER BY x)
       FROM unnest(coalesce(rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_pm_config_alertas_salvar','fn_pm_config_proposta_salvar']) AS x
   )
 WHERE rota = '/dashboard/pm/configuracoes';
