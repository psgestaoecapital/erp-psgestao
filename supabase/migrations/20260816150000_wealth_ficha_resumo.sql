-- Wealth · Padrão Premium (ficha 360°) — 2 RPCs de resumo para a lista rica e a ficha do cliente.
-- Origem: Eng. Chefe. SÓ apresentação: reusa todo o backend (suitability/ips/recomendacao/validar_ips).
-- Auditado (RD-26): AUM = SUM(wealth_positions.valor_atual_brl); consultor_responsavel(uuid)→users.full_name;
--   validade do perfil = wealth_suitability_resposta.valido_ate mais recente; IPS aprovado = wealth_ips.ativo.
--   wealth_recomendacao pode não existir ainda (pós-#1025) → guarda com to_regclass (RD-51, não quebra).
-- Aditivo (RD-30), leitura pura, escopo por company_id (RD-45).

-- ── 1) Lista rica de clientes (porta de entrada /dashboard/wealth) ───────────────
CREATE OR REPLACE FUNCTION public.fn_wealth_clientes_lista(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_lista jsonb;
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'company_id ausente'); END IF;
  IF NOT is_admin() AND NOT EXISTS (SELECT 1 FROM wealth_consultores WHERE user_id = auth.uid() AND ativo AND company_id = p_company_id)
     AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY lower(t.nome)), '[]'::jsonb) INTO v_lista FROM (
    SELECT c.id, c.nome, c.foto_url, c.perfil_risco, c.status,
      c.consultor_responsavel AS consultor_id, u.full_name AS consultor_nome,
      COALESCE(p.aum, 0) AS aum, COALESCE(p.num_posicoes, 0) AS num_posicoes,
      s.valido_ate,
      (s.valido_ate IS NULL OR s.valido_ate < CURRENT_DATE) AS perfil_vencido
    FROM wealth_clients c
    LEFT JOIN users u ON u.id = c.consultor_responsavel
    LEFT JOIN LATERAL (
      SELECT SUM(wp.valor_atual_brl) AS aum, count(*) AS num_posicoes
      FROM wealth_positions wp WHERE wp.client_id = c.id) p ON true
    LEFT JOIN LATERAL (
      SELECT sr.valido_ate FROM wealth_suitability_resposta sr
      WHERE sr.client_id = c.id ORDER BY sr.respondido_em DESC LIMIT 1) s ON true
    WHERE c.company_id = p_company_id
  ) t;

  RETURN jsonb_build_object('ok', true, 'clientes', v_lista);
END;
$function$;

-- ── 2) Resumo 360° do cliente (header + aba Visão Geral) ─────────────────────────
--   AUM, alocação atual por classe, aderência ao IPS (via fn_wealth_validar_ips), perfil+validade e
--   alertas consolidados (perfil vencido/ausente, IPS não aprovado, drift fora da banda, recomendação pendente).
CREATE OR REPLACE FUNCTION public.fn_wealth_cliente_resumo(p_client_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_company uuid; v_cli jsonb; v_aum numeric; v_aloc jsonb; v_aderencia jsonb;
  v_perfil text; v_valido date; v_vencido boolean; v_tem_ips boolean;
  v_alertas jsonb := '[]'::jsonb; v_rec_pend int := 0;
BEGIN
  SELECT company_id INTO v_company FROM wealth_clients WHERE id = p_client_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'cliente não encontrado'); END IF;
  IF NOT is_admin() AND NOT EXISTS (SELECT 1 FROM wealth_consultores WHERE user_id = auth.uid() AND ativo AND company_id = v_company)
     AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;

  SELECT jsonb_build_object(
    'id', c.id, 'nome', c.nome, 'foto_url', c.foto_url, 'perfil_risco', c.perfil_risco, 'status', c.status,
    'consultor_nome', u.full_name, 'pep', c.pep, 'investidor_qualificado', c.investidor_qualificado,
    'investidor_profissional', c.investidor_profissional, 'renda_mensal', c.renda_mensal,
    'patrimonio_declarado', c.patrimonio_declarado, 'profissao', c.profissao, 'email', c.email, 'telefone', c.telefone)
  INTO v_cli FROM wealth_clients c LEFT JOIN users u ON u.id = c.consultor_responsavel WHERE c.id = p_client_id;

  SELECT COALESCE(SUM(valor_atual_brl), 0) INTO v_aum FROM wealth_positions WHERE client_id = p_client_id;

  WITH tot AS (SELECT NULLIF(SUM(valor_atual_brl), 0) AS t FROM wealth_positions WHERE client_id = p_client_id)
  SELECT COALESCE(jsonb_object_agg(classe, pct), '{}'::jsonb) INTO v_aloc FROM (
    SELECT a.classe, ROUND((SUM(wp.valor_atual_brl) / (SELECT t FROM tot) * 100)::numeric, 2) AS pct
    FROM wealth_positions wp JOIN wealth_assets a ON a.id = wp.asset_id
    WHERE wp.client_id = p_client_id GROUP BY a.classe
  ) s;

  v_aderencia := fn_wealth_validar_ips(p_client_id);

  SELECT perfil_resultado, valido_ate INTO v_perfil, v_valido
  FROM wealth_suitability_resposta WHERE client_id = p_client_id ORDER BY respondido_em DESC LIMIT 1;
  v_vencido := (v_valido IS NULL) OR (v_valido < CURRENT_DATE);
  v_tem_ips := EXISTS (SELECT 1 FROM wealth_ips WHERE client_id = p_client_id AND ativo = true);

  IF v_perfil IS NULL THEN
    v_alertas := v_alertas || jsonb_build_object('tipo','suitability_ausente','severidade','alta','msg','Cliente sem suitability — perfil de risco não definido.');
  ELSIF v_vencido THEN
    v_alertas := v_alertas || jsonb_build_object('tipo','perfil_vencido','severidade','alta','msg','Perfil de risco vencido — refazer o suitability.');
  END IF;
  IF NOT v_tem_ips THEN
    v_alertas := v_alertas || jsonb_build_object('tipo','ips_nao_aprovado','severidade','media','msg','Sem IPS aprovado — defina e aprove a política de investimento.');
  END IF;
  IF COALESCE((v_aderencia->>'precisa_rebalancear')::boolean, false) THEN
    v_alertas := v_alertas || jsonb_build_object('tipo','drift','severidade','media','msg','Carteira fora das bandas do IPS — rebalanceamento sugerido.');
  END IF;
  -- wealth_recomendacao só existe pós-#1025; guarda pra não quebrar antes do merge (RD-51)
  IF to_regclass('public.wealth_recomendacao') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.wealth_recomendacao WHERE client_id = $1 AND status = ''aguarda_aprovacao'''
      INTO v_rec_pend USING p_client_id;
    IF v_rec_pend > 0 THEN
      v_alertas := v_alertas || jsonb_build_object('tipo','recomendacao_pendente','severidade','baixa','msg', format('%s recomendação(ões) aguardando aprovação do consultor CVM 19.', v_rec_pend));
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'cliente', v_cli, 'aum', v_aum, 'alocacao_atual', v_aloc,
    'aderencia', v_aderencia, 'perfil', v_perfil, 'perfil_valido_ate', v_valido, 'perfil_vencido', v_vencido,
    'tem_ips_aprovado', v_tem_ips, 'alertas', v_alertas,
    'aprovador_atual', fn_wealth_user_eh_aprovador_cvm19(v_company));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_wealth_clientes_lista(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_wealth_cliente_resumo(uuid) TO authenticated;
