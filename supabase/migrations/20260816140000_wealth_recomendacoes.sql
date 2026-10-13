-- Wealth · Recomendações (CVM 19) — 3ª tela do ciclo. Origem: Eng. Chefe. Depende do #1024 (IPS + trava CVM 19).
-- O consultor gera recomendações usando o IPS APROVADO como baliza (carteira atual × alocação-alvo → comprar/vender),
-- e o André (fn_wealth_user_eh_aprovador_cvm19) aprova cada uma. Aditivo (RD-30), RLS por company_id (RD-45).
-- Auditado (RD-26): não há tabela de recomendação → criar. fn_wealth_validar_ips já mede o drift por classe
--   (carteira valor_atual_brl × alocacao_alvo, bandas ±5pp default) e exige IPS ativo → reuso como motor.
--   Nota: wealth_assets.classe (fundos/outros/renda_fixa_pos/renda_variavel) é mais grossa que as chaves do IPS;
--   o motor faz COALESCE→0, então classes sem correspondência aparecem como 0% (transparente, RD-51).
--   wealth_positions NÃO tem company_id (escopo via client_id→wealth_clients). "IPS ativo" já = aprovado (#1024).

-- ── 1) Tabela de recomendação ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wealth_recomendacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  client_id uuid REFERENCES public.wealth_clients(id) ON DELETE CASCADE,
  ips_id uuid REFERENCES public.wealth_ips(id),        -- a baliza: versão do IPS que balizou (rastro CVM 19)
  tipo text NOT NULL,                                  -- aporte | resgate | rebalanceamento | troca
  classe text,
  asset_id uuid REFERENCES public.wealth_assets(id),
  acao text NOT NULL,                                  -- comprar | vender | manter
  valor numeric, quantidade numeric,
  peso_alvo numeric, peso_atual numeric,
  justificativa text,                                  -- por que (drift, objetivo, liquidez) — obrigatória
  status text DEFAULT 'rascunho',                      -- rascunho | aguarda_aprovacao | aprovada | rejeitada | executada
  gerada_por text DEFAULT 'consultor',                 -- consultor | sistema
  criado_por uuid, criado_em timestamptz DEFAULT now(),
  aprovado_por uuid, aprovado_em timestamptz, obs_aprovacao text
);
ALTER TABLE public.wealth_recomendacao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wealth_recomendacao_rls ON public.wealth_recomendacao;
CREATE POLICY wealth_recomendacao_rls ON public.wealth_recomendacao
  USING (company_id IN (SELECT get_user_company_ids())) WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE INDEX IF NOT EXISTS idx_wealth_recomendacao_cli ON public.wealth_recomendacao(company_id, client_id, status);

-- ── 2) fn_wealth_recomendacao_gerar — sugestões de rebalanceamento a partir do IPS aprovado (não grava) ──
--   Usa fn_wealth_validar_ips (drift por classe, bandas do IPS). Classe abaixo da banda → comprar/aportar;
--   acima → vender/resgatar. valor_sugerido = |alvo - atual|/100 × total_carteira. Sem IPS aprovado → avisa.
CREATE OR REPLACE FUNCTION public.fn_wealth_recomendacao_gerar(p_client_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_company uuid; v_ips_id uuid; v_ips_versao int; v_total numeric; v_val jsonb;
  v_sug jsonb := '[]'::jsonb; v_d jsonb; v_status text; v_alvo numeric; v_atual numeric; v_delta numeric;
BEGIN
  SELECT company_id INTO v_company FROM wealth_clients WHERE id = p_client_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'cliente não encontrado'); END IF;
  IF NOT is_admin() AND NOT EXISTS (SELECT 1 FROM wealth_consultores WHERE user_id = auth.uid() AND ativo AND company_id = v_company)
     AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;

  SELECT id, versao INTO v_ips_id, v_ips_versao FROM wealth_ips
   WHERE client_id = p_client_id AND ativo = true ORDER BY versao DESC LIMIT 1;
  IF v_ips_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'sem_ips', true,
      'erro', 'Cliente sem IPS aprovado — aprove a Política de Investimento antes de gerar recomendações.');
  END IF;

  v_val := fn_wealth_validar_ips(p_client_id);                       -- motor de drift (reuso, RD-52)
  IF COALESCE((v_val->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'erro', COALESCE(v_val->>'error','falha ao validar IPS'));
  END IF;

  SELECT COALESCE(SUM(valor_atual_brl),0) INTO v_total FROM wealth_positions WHERE client_id = p_client_id;

  FOR v_d IN SELECT * FROM jsonb_array_elements(v_val->'desvios')
  LOOP
    v_status := v_d->>'status';
    IF v_status NOT IN ('abaixo_banda','acima_banda') THEN CONTINUE; END IF;   -- só o que está fora da banda
    v_alvo  := COALESCE((v_d->>'alvo_pct')::numeric,0);
    v_atual := COALESCE((v_d->>'atual_pct')::numeric,0);
    v_delta := round(abs(v_alvo - v_atual) / 100.0 * v_total, 2);
    v_sug := v_sug || jsonb_build_object(
      'classe', v_d->>'classe',
      'acao', CASE WHEN v_status = 'abaixo_banda' THEN 'comprar' ELSE 'vender' END,
      'tipo', 'rebalanceamento',
      'peso_alvo', v_alvo, 'peso_atual', v_atual, 'drift_pp', (v_d->>'desvio_pp')::numeric,
      'valor_sugerido', v_delta,
      'justificativa', format('%s da classe %s: atual %s%% vs alvo %s%% (fora da banda %s–%s%%).',
        CASE WHEN v_status = 'abaixo_banda' THEN 'Aportar' ELSE 'Reduzir' END,
        v_d->>'classe', v_atual, v_alvo, v_d->>'banda_min', v_d->>'banda_max'));
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'ips_id', v_ips_id, 'ips_versao', v_ips_versao,
    'total_carteira', v_total, 'aderencia', v_val, 'sugestoes', v_sug,
    'precisa_rebalancear', COALESCE((v_val->>'precisa_rebalancear')::boolean, false));
END;
$function$;

-- ── 3) fn_wealth_recomendacao_criar — o consultor cria (de uma sugestão ou manual); status aguarda_aprovacao ──
--   justificativa OBRIGATÓRIA (rastro CVM 19). ips_id default = IPS ativo (baliza). Nunca cria já-aprovada.
CREATE OR REPLACE FUNCTION public.fn_wealth_recomendacao_criar(p_campos jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_client uuid := NULLIF(btrim(p_campos->>'client_id'),'')::uuid; v_company uuid; v_ips uuid; v_id uuid;
  v_just text := NULLIF(btrim(p_campos->>'justificativa'),'');
BEGIN
  IF v_client IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'client_id obrigatório'); END IF;
  SELECT company_id INTO v_company FROM wealth_clients WHERE id = v_client;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'cliente não encontrado'); END IF;
  IF NOT is_admin() AND NOT EXISTS (SELECT 1 FROM wealth_consultores WHERE user_id = auth.uid() AND ativo AND company_id = v_company)
     AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;
  IF v_just IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'justificativa obrigatória (CVM 19)'); END IF;

  v_ips := NULLIF(btrim(p_campos->>'ips_id'),'')::uuid;
  IF v_ips IS NULL THEN
    SELECT id INTO v_ips FROM wealth_ips WHERE client_id = v_client AND ativo = true ORDER BY versao DESC LIMIT 1;
  END IF;

  INSERT INTO wealth_recomendacao (company_id, client_id, ips_id, tipo, classe, asset_id, acao,
    valor, quantidade, peso_alvo, peso_atual, justificativa, status, gerada_por, criado_por)
  VALUES (v_company, v_client, v_ips,
    COALESCE(NULLIF(btrim(p_campos->>'tipo'),''),'rebalanceamento'),
    NULLIF(btrim(p_campos->>'classe'),''),
    NULLIF(btrim(p_campos->>'asset_id'),'')::uuid,
    COALESCE(NULLIF(btrim(p_campos->>'acao'),''),'comprar'),
    NULLIF(p_campos->>'valor','')::numeric, NULLIF(p_campos->>'quantidade','')::numeric,
    NULLIF(p_campos->>'peso_alvo','')::numeric, NULLIF(p_campos->>'peso_atual','')::numeric,
    v_just, 'aguarda_aprovacao', COALESCE(NULLIF(btrim(p_campos->>'gerada_por'),''),'consultor'), auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'ips_id', v_ips, 'status', 'aguarda_aprovacao');
END;
$function$;

-- ── 4) fn_wealth_recomendacao_aprovar / _rejeitar — SÓ o aprovador CVM 19 (André). Carimba autor+data+motivo. ──
CREATE OR REPLACE FUNCTION public.fn_wealth_recomendacao_aprovar(p_id uuid, p_obs text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_company uuid; v_status text;
BEGIN
  SELECT company_id, status INTO v_company, v_status FROM wealth_recomendacao WHERE id = p_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'recomendação não encontrada'); END IF;
  IF NOT fn_wealth_user_eh_aprovador_cvm19(v_company) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'aprovação restrita ao consultor habilitado CVM 19');
  END IF;
  IF v_status = 'aprovada' THEN RETURN jsonb_build_object('ok', false, 'erro', 'já aprovada'); END IF;
  UPDATE wealth_recomendacao SET status = 'aprovada', aprovado_por = auth.uid(), aprovado_em = now(),
    obs_aprovacao = NULLIF(btrim(p_obs),'') WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'id', p_id, 'status', 'aprovada', 'aprovado_por', auth.uid());
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_wealth_recomendacao_rejeitar(p_id uuid, p_motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM wealth_recomendacao WHERE id = p_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'recomendação não encontrada'); END IF;
  IF NOT fn_wealth_user_eh_aprovador_cvm19(v_company) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'rejeição restrita ao consultor habilitado CVM 19');
  END IF;
  IF NULLIF(btrim(p_motivo),'') IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'motivo obrigatório'); END IF;
  UPDATE wealth_recomendacao SET status = 'rejeitada', aprovado_por = auth.uid(), aprovado_em = now(),
    obs_aprovacao = btrim(p_motivo) WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'id', p_id, 'status', 'rejeitada');
END;
$function$;

-- ── 5) fn_wealth_recomendacao_listar — recomendações + aderência atual + flag do aprovador (gating da UI) ──
CREATE OR REPLACE FUNCTION public.fn_wealth_recomendacao_listar(p_client_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_company uuid; v_lista jsonb;
BEGIN
  SELECT company_id INTO v_company FROM wealth_clients WHERE id = p_client_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'cliente não encontrado'); END IF;
  IF NOT is_admin() AND NOT EXISTS (SELECT 1 FROM wealth_consultores WHERE user_id = auth.uid() AND ativo AND company_id = v_company)
     AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.criado_em DESC), '[]'::jsonb) INTO v_lista
  FROM wealth_recomendacao r WHERE r.client_id = p_client_id;

  RETURN jsonb_build_object('ok', true,
    'recomendacoes', v_lista,
    'aderencia', fn_wealth_validar_ips(p_client_id),
    'aprovador_atual', fn_wealth_user_eh_aprovador_cvm19(v_company));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_wealth_recomendacao_gerar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_wealth_recomendacao_criar(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_wealth_recomendacao_aprovar(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_wealth_recomendacao_rejeitar(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_wealth_recomendacao_listar(uuid) TO authenticated;
