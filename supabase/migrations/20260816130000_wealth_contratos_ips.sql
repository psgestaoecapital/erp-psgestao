-- Wealth · Contratos + IPS (CVM 19) — 2ª tela do ciclo. Origem: Eng. Chefe.
-- Formaliza a consultoria (termo) e cria o IPS (política de investimento) a partir do perfil do Suitability.
-- Aprovação EXCLUSIVA do consultor habilitado CVM 19 (o André). Aditivo (RD-30).
-- Auditado (RD-26): wealth_ips (SEM company_id — escopo via client_id) e wealth_ips_templates (5 templates:
--   conservador/moderado/balanceado/arrojado/agressivo) JÁ existem → não re-semeia. fn_wealth_validar_ips
--   mede DRIFT (alocação atual × alvo, exige IPS ativo) → NÃO serve p/ coerência de rascunho; criei
--   fn_wealth_ips_coerencia (perfil × alocação-alvo). André = wealth_consultores.certificacao->>'cvm_19'.

-- ── 1) Contrato de consultoria (termo) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wealth_contrato_consultoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  client_id uuid REFERENCES public.wealth_clients(id) ON DELETE CASCADE,
  tipo text DEFAULT 'consultoria_cvm19',
  data_inicio date, data_fim date,
  honorario_tipo text,                 -- fee_fixo | percentual_aum | misto
  honorario_valor numeric, honorario_pct numeric,
  status text DEFAULT 'rascunho',      -- rascunho | vigente | encerrado
  documento_url text, aceito_em timestamptz, aceito_por text,
  criado_em timestamptz DEFAULT now(), atualizado_em timestamptz DEFAULT now()
);
ALTER TABLE public.wealth_contrato_consultoria ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wealth_contrato_rls ON public.wealth_contrato_consultoria;
CREATE POLICY wealth_contrato_rls ON public.wealth_contrato_consultoria
  USING (company_id IN (SELECT get_user_company_ids())) WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE INDEX IF NOT EXISTS idx_wealth_contrato_cli ON public.wealth_contrato_consultoria(company_id, client_id);

-- ── 2) Aprovador CVM 19 (só quem tem certificacao.cvm_19 = true e está ativo na empresa) ─────────
CREATE OR REPLACE FUNCTION public.fn_wealth_user_eh_aprovador_cvm19(p_company_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS(
    SELECT 1 FROM wealth_consultores
    WHERE user_id = auth.uid() AND ativo = true AND company_id = p_company_id
      AND (certificacao->>'cvm_19')::boolean IS TRUE);
$function$;

-- ── 3) Coerência perfil × alocação-alvo (o alerta "conservador com muita RV") ────
--   Risco = renda_variavel + exterior + alternativos. Teto por perfil. Também confere soma ≈ 100.
CREATE OR REPLACE FUNCTION public.fn_wealth_ips_coerencia(p_perfil text, p_alocacao jsonb)
 RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE v_risco numeric; v_soma numeric; v_teto numeric;
BEGIN
  v_risco := COALESCE((p_alocacao->>'renda_variavel')::numeric,0)
           + COALESCE((p_alocacao->>'exterior')::numeric,0)
           + COALESCE((p_alocacao->>'alternativos')::numeric,0);
  SELECT COALESCE(sum(value::numeric),0) INTO v_soma FROM jsonb_each_text(COALESCE(p_alocacao,'{}'::jsonb));
  v_teto := CASE lower(COALESCE(p_perfil,'')) WHEN 'conservador' THEN 20 WHEN 'moderado' THEN 40 WHEN 'arrojado' THEN 70 ELSE 100 END;
  RETURN jsonb_build_object(
    'risco_pct', v_risco, 'teto_perfil', v_teto, 'soma_pct', v_soma,
    'coerente', (v_risco <= v_teto),
    'soma_ok', (abs(v_soma - 100) <= 0.5),
    'aviso', CASE WHEN v_risco > v_teto
                  THEN format('Alocação de risco (%s%%) acima do teto do perfil %s (%s%%).', v_risco, p_perfil, v_teto)
                  WHEN abs(v_soma - 100) > 0.5 THEN format('A alocação soma %s%% (deveria somar 100%%).', v_soma)
                  ELSE NULL END);
END;
$function$;

-- ── 4) fn_wealth_ips_criar — herda perfil do Suitability + aplica template do perfil; versiona; não-aprovado.
CREATE OR REPLACE FUNCTION public.fn_wealth_ips_criar(p_client_id uuid, p_template_id uuid DEFAULT NULL, p_campos jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_company uuid; v_perfil text; v_tpl record; v_aloc jsonb; v_versao int; v_id uuid;
BEGIN
  SELECT company_id, perfil_risco INTO v_company, v_perfil FROM wealth_clients WHERE id = p_client_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'cliente não encontrado'); END IF;
  IF NOT is_admin() AND NOT EXISTS (SELECT 1 FROM wealth_consultores WHERE user_id = auth.uid() AND ativo AND company_id = v_company)
     AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;
  IF v_perfil IS NULL OR btrim(v_perfil) = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'cliente sem perfil — faça o Suitability primeiro');
  END IF;

  -- template: por id, senão o do perfil
  SELECT * INTO v_tpl FROM wealth_ips_templates
   WHERE (p_template_id IS NOT NULL AND id = p_template_id)
      OR (p_template_id IS NULL AND perfil_risco = v_perfil AND COALESCE(ativo,true))
   ORDER BY updated_at DESC NULLS LAST LIMIT 1;

  -- alocação: a enviada, senão a do template
  v_aloc := COALESCE(NULLIF(p_campos->'alocacao_alvo','null'::jsonb), v_tpl.alocacao_alvo);
  IF v_aloc IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem alocação-alvo (nem enviada, nem template)'); END IF;

  SELECT COALESCE(max(versao),0)+1 INTO v_versao FROM wealth_ips WHERE client_id = p_client_id;

  INSERT INTO wealth_ips (
    client_id, versao, perfil_risco, horizonte_investimento, objetivo_principal, restricoes_texto,
    alocacao_alvo, bandas_rebalanceamento, benchmark, frequencia_rebalanceamento,
    restricoes_esg, restricoes_concentracao, liquidez_minima, ativo
  ) VALUES (
    p_client_id, v_versao, v_perfil,
    NULLIF(btrim(p_campos->>'horizonte_investimento'),''),
    NULLIF(btrim(p_campos->>'objetivo_principal'),''),
    NULLIF(btrim(p_campos->>'restricoes_texto'),''),
    v_aloc,
    COALESCE(NULLIF(p_campos->'bandas_rebalanceamento','null'::jsonb), v_tpl.bandas_rebalanceamento),
    COALESCE(NULLIF(btrim(p_campos->>'benchmark'),''), v_tpl.benchmark),
    COALESCE(NULLIF(btrim(p_campos->>'frequencia_rebalanceamento'),''), v_tpl.frequencia_rebalanceamento),
    NULLIF(p_campos->'restricoes_esg','null'::jsonb),
    NULLIF(p_campos->'restricoes_concentracao','null'::jsonb),
    COALESCE(NULLIF(p_campos->'liquidez_minima','null'::jsonb), v_tpl.liquidez_minima),
    false
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'ips_id', v_id, 'versao', v_versao, 'perfil', v_perfil,
    'coerencia', fn_wealth_ips_coerencia(v_perfil, v_aloc));
END;
$function$;

-- ── 5) fn_wealth_ips_aprovar — SÓ o aprovador CVM 19; valida coerência; ativa e desativa versões anteriores.
CREATE OR REPLACE FUNCTION public.fn_wealth_ips_aprovar(p_ips_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ips record; v_company uuid; v_coer jsonb;
BEGIN
  SELECT i.*, c.company_id AS company_id INTO v_ips
  FROM wealth_ips i JOIN wealth_clients c ON c.id = i.client_id WHERE i.id = p_ips_id;
  IF v_ips IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'IPS não encontrado'); END IF;
  v_company := v_ips.company_id;

  -- trava CVM 19: só o consultor habilitado (André)
  IF NOT fn_wealth_user_eh_aprovador_cvm19(v_company) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'aprovação restrita ao consultor habilitado CVM 19');
  END IF;

  v_coer := fn_wealth_ips_coerencia(v_ips.perfil_risco, v_ips.alocacao_alvo);

  -- versiona: desativa as outras versões do cliente, ativa esta
  UPDATE wealth_ips SET ativo = false WHERE client_id = v_ips.client_id AND id <> p_ips_id;
  UPDATE wealth_ips SET ativo = true, aprovado_por = auth.uid(), aprovado_em = now() WHERE id = p_ips_id;

  RETURN jsonb_build_object('ok', true, 'ips_id', p_ips_id, 'aprovado_por', auth.uid(), 'aprovado_em', now(),
    'coerencia', v_coer);
END;
$function$;

-- ── 6) fn_wealth_ips_obter — IPS ativo + histórico de versões ────────────────────
CREATE OR REPLACE FUNCTION public.fn_wealth_ips_obter(p_client_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_company uuid; v_ativo jsonb; v_hist jsonb;
BEGIN
  SELECT company_id INTO v_company FROM wealth_clients WHERE id = p_client_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'cliente não encontrado'); END IF;
  IF NOT is_admin() AND NOT EXISTS (SELECT 1 FROM wealth_consultores WHERE user_id = auth.uid() AND ativo AND company_id = v_company)
     AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;

  SELECT to_jsonb(i) INTO v_ativo FROM wealth_ips i WHERE i.client_id = p_client_id AND i.ativo = true ORDER BY i.versao DESC LIMIT 1;
  SELECT jsonb_agg(jsonb_build_object('id', i.id, 'versao', i.versao, 'perfil_risco', i.perfil_risco,
           'ativo', i.ativo, 'aprovado_por', i.aprovado_por, 'aprovado_em', i.aprovado_em, 'created_at', i.created_at) ORDER BY i.versao DESC)
    INTO v_hist FROM wealth_ips i WHERE i.client_id = p_client_id;

  RETURN jsonb_build_object('ok', true,
    'ativo', v_ativo,
    'aprovador_atual', fn_wealth_user_eh_aprovador_cvm19(v_company),
    'historico', COALESCE(v_hist, '[]'::jsonb));
END;
$function$;

-- ── 7) fn_wealth_contrato_consultoria_salvar — cria/edita o termo ────────────────
CREATE OR REPLACE FUNCTION public.fn_wealth_contrato_consultoria_salvar(p_campos jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id uuid := NULLIF(btrim(p_campos->>'id'),'')::uuid; v_client uuid := NULLIF(btrim(p_campos->>'client_id'),'')::uuid; v_company uuid;
BEGIN
  IF v_client IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'client_id obrigatório'); END IF;
  SELECT company_id INTO v_company FROM wealth_clients WHERE id = v_client;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'cliente não encontrado'); END IF;
  IF NOT is_admin() AND NOT EXISTS (SELECT 1 FROM wealth_consultores WHERE user_id = auth.uid() AND ativo AND company_id = v_company)
     AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO wealth_contrato_consultoria (company_id, client_id, tipo, data_inicio, data_fim,
      honorario_tipo, honorario_valor, honorario_pct, status, documento_url, aceito_em, aceito_por)
    VALUES (v_company, v_client, COALESCE(NULLIF(btrim(p_campos->>'tipo'),''),'consultoria_cvm19'),
      NULLIF(btrim(p_campos->>'data_inicio'),'')::date, NULLIF(btrim(p_campos->>'data_fim'),'')::date,
      NULLIF(btrim(p_campos->>'honorario_tipo'),''), NULLIF(p_campos->>'honorario_valor','')::numeric,
      NULLIF(p_campos->>'honorario_pct','')::numeric, COALESCE(NULLIF(btrim(p_campos->>'status'),''),'rascunho'),
      NULLIF(btrim(p_campos->>'documento_url'),''), NULLIF(btrim(p_campos->>'aceito_em'),'')::timestamptz, NULLIF(btrim(p_campos->>'aceito_por'),''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE wealth_contrato_consultoria SET
      tipo = COALESCE(NULLIF(btrim(p_campos->>'tipo'),''), tipo),
      data_inicio = COALESCE(NULLIF(btrim(p_campos->>'data_inicio'),'')::date, data_inicio),
      data_fim = COALESCE(NULLIF(btrim(p_campos->>'data_fim'),'')::date, data_fim),
      honorario_tipo = COALESCE(NULLIF(btrim(p_campos->>'honorario_tipo'),''), honorario_tipo),
      honorario_valor = COALESCE(NULLIF(p_campos->>'honorario_valor','')::numeric, honorario_valor),
      honorario_pct = COALESCE(NULLIF(p_campos->>'honorario_pct','')::numeric, honorario_pct),
      status = COALESCE(NULLIF(btrim(p_campos->>'status'),''), status),
      documento_url = COALESCE(NULLIF(btrim(p_campos->>'documento_url'),''), documento_url),
      aceito_em = COALESCE(NULLIF(btrim(p_campos->>'aceito_em'),'')::timestamptz, aceito_em),
      aceito_por = COALESCE(NULLIF(btrim(p_campos->>'aceito_por'),''), aceito_por),
      atualizado_em = now()
    WHERE id = v_id AND company_id = v_company;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_wealth_user_eh_aprovador_cvm19(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_wealth_ips_coerencia(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_wealth_ips_criar(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_wealth_ips_aprovar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_wealth_ips_obter(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_wealth_contrato_consultoria_salvar(jsonb) TO authenticated;
