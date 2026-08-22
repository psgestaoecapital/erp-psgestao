-- Wealth · Taxonomia única de classes (asset ↔ IPS). Origem: Eng. Chefe. Pré-requisito das Recomendações.
-- Canônica = as 7 chaves do IPS: renda_fixa_pos/pre/inflacao, renda_variavel, fundos_imob, exterior, alternativos.
-- Auditado (RD-26): 7 assets. Inequívoco → GGRC11 (ISIN BRGGRCCTF002, FII) está renda_variavel, deveria fundos_imob.
--   BOVA11/TAEE11 corretos (renda_variavel); CDB-BTG correto (renda_fixa_pos). AMBÍGUOS/teste (fundos/outros):
--   'Fondo Premium/Basic' (CNPJ fake) e 'ITAU Sandbox previdência' → NÃO reclassifico às cegas (decisão do André).
-- Estratégia (RD-51/RD-54/RD-55): backup + só o fix inequívoco (GGRC11); os não-canônicos ficam SINALIZADOS
--   ("ativo sem classe canônica") em vez de tratados como 0% — nunca recomenda aporte sobre buraco de cadastro.
--   O CHECK rígido "0 fora da taxonomia" fica pra um fast-follow, quando o André resolver os 3 (real→classifica /
--   teste→limpeza). Aditivo; a reclassificação é reversível pelo backup.

-- ── 1) Backup da classe atual (RD-54/55) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wealth_assets_classe_bkp_20260816 (
  asset_id uuid, ticker text, nome text, classe_anterior text, snapshot_em timestamptz DEFAULT now()
);
INSERT INTO public.wealth_assets_classe_bkp_20260816 (asset_id, ticker, nome, classe_anterior)
SELECT a.id, a.ticker, a.nome, a.classe FROM public.wealth_assets a
WHERE NOT EXISTS (SELECT 1 FROM public.wealth_assets_classe_bkp_20260816 b WHERE b.asset_id = a.id);

-- ── 2) Reclassificação inequívoca: GGRC11 (FII) → fundos_imob (por ISIN, estável) ─
UPDATE public.wealth_assets SET classe = 'fundos_imob'
WHERE isin = 'BRGGRCCTF002' AND classe IS DISTINCT FROM 'fundos_imob';

-- ── 3) Taxonomia canônica como função única (asset e IPS compartilham) ───────────
CREATE OR REPLACE FUNCTION public.fn_wealth_classe_canonica(p_classe text)
 RETURNS boolean LANGUAGE sql IMMUTABLE AS $function$
  SELECT p_classe IN ('renda_fixa_pos','renda_fixa_pre','renda_fixa_inflacao','renda_variavel','fundos_imob','exterior','alternativos');
$function$;
GRANT EXECUTE ON FUNCTION public.fn_wealth_classe_canonica(text) TO authenticated;

-- ── 4) Resumo passa a SINALIZAR ativos sem classe canônica (RD-51) ───────────────
--   Reemite fn_wealth_cliente_resumo (do #1027) + campo 'ativos_sem_classe_canonica' (não tratar como 0%).
CREATE OR REPLACE FUNCTION public.fn_wealth_cliente_resumo(p_client_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_company uuid; v_cli jsonb; v_aum numeric; v_aloc jsonb; v_aderencia jsonb;
  v_perfil text; v_valido date; v_vencido boolean; v_tem_ips boolean;
  v_alertas jsonb := '[]'::jsonb; v_rec_pend int := 0; v_sem_classe jsonb; v_n_sem int;
BEGIN
  SELECT company_id INTO v_company FROM wealth_clients WHERE id = p_client_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'cliente não encontrado'); END IF;
  IF NOT is_admin() AND NOT EXISTS (SELECT 1 FROM wealth_consultores WHERE user_id = auth.uid() AND ativo AND company_id = v_company)
     AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;
  SELECT jsonb_build_object('id', c.id, 'nome', c.nome, 'foto_url', c.foto_url, 'perfil_risco', c.perfil_risco, 'status', c.status,
    'consultor_nome', u.full_name, 'pep', c.pep, 'investidor_qualificado', c.investidor_qualificado,
    'investidor_profissional', c.investidor_profissional, 'renda_mensal', c.renda_mensal,
    'patrimonio_declarado', c.patrimonio_declarado, 'profissao', c.profissao, 'email', c.email, 'telefone', c.telefone)
  INTO v_cli FROM wealth_clients c LEFT JOIN users u ON u.id = c.consultor_responsavel WHERE c.id = p_client_id;

  SELECT COALESCE(SUM(valor_atual_brl), 0) INTO v_aum FROM wealth_positions WHERE client_id = p_client_id;

  WITH tot AS (SELECT NULLIF(SUM(valor_atual_brl), 0) AS t FROM wealth_positions WHERE client_id = p_client_id)
  SELECT COALESCE(jsonb_object_agg(classe, pct), '{}'::jsonb) INTO v_aloc FROM (
    SELECT a.classe, ROUND((SUM(wp.valor_atual_brl) / (SELECT t FROM tot) * 100)::numeric, 2) AS pct
    FROM wealth_positions wp JOIN wealth_assets a ON a.id = wp.asset_id WHERE wp.client_id = p_client_id GROUP BY a.classe) s;

  v_aderencia := fn_wealth_validar_ips(p_client_id);

  SELECT perfil_resultado, valido_ate INTO v_perfil, v_valido FROM wealth_suitability_resposta WHERE client_id = p_client_id ORDER BY respondido_em DESC LIMIT 1;
  v_vencido := (v_valido IS NULL) OR (v_valido < CURRENT_DATE);
  v_tem_ips := EXISTS (SELECT 1 FROM wealth_ips WHERE client_id = p_client_id AND ativo = true);

  -- ativos com classe FORA da taxonomia canônica → sinaliza (não é 0% real, é buraco de cadastro)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('asset_id', a.id, 'ticker', a.ticker, 'nome', a.nome, 'classe', a.classe, 'valor', wp.valor_atual_brl)), '[]'::jsonb), count(*)
  INTO v_sem_classe, v_n_sem
  FROM wealth_positions wp JOIN wealth_assets a ON a.id = wp.asset_id
  WHERE wp.client_id = p_client_id AND NOT fn_wealth_classe_canonica(a.classe);

  IF v_perfil IS NULL THEN
    v_alertas := v_alertas || jsonb_build_object('tipo','suitability_ausente','severidade','alta','msg','Cliente sem suitability — perfil de risco não definido.');
  ELSIF v_vencido THEN
    v_alertas := v_alertas || jsonb_build_object('tipo','perfil_vencido','severidade','alta','msg','Perfil de risco vencido — refazer o suitability.');
  END IF;
  IF NOT v_tem_ips THEN
    v_alertas := v_alertas || jsonb_build_object('tipo','ips_nao_aprovado','severidade','media','msg','Sem IPS aprovado — defina e aprove a política de investimento.');
  END IF;
  IF v_n_sem > 0 THEN
    v_alertas := v_alertas || jsonb_build_object('tipo','classe_nao_canonica','severidade','media',
      'msg', format('%s ativo(s) sem classe canônica — classifique para a aderência/recomendação serem precisas.', v_n_sem));
  END IF;
  IF COALESCE((v_aderencia->>'precisa_rebalancear')::boolean, false) THEN
    v_alertas := v_alertas || jsonb_build_object('tipo','drift','severidade','media','msg','Carteira fora das bandas do IPS — rebalanceamento sugerido.');
  END IF;
  IF to_regclass('public.wealth_recomendacao') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.wealth_recomendacao WHERE client_id = $1 AND status = ''aguarda_aprovacao''' INTO v_rec_pend USING p_client_id;
    IF v_rec_pend > 0 THEN
      v_alertas := v_alertas || jsonb_build_object('tipo','recomendacao_pendente','severidade','baixa','msg', format('%s recomendação(ões) aguardando aprovação do consultor CVM 19.', v_rec_pend));
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'cliente', v_cli, 'aum', v_aum, 'alocacao_atual', v_aloc, 'aderencia', v_aderencia,
    'perfil', v_perfil, 'perfil_valido_ate', v_valido, 'perfil_vencido', v_vencido, 'tem_ips_aprovado', v_tem_ips,
    'ativos_sem_classe_canonica', v_sem_classe, 'alertas', v_alertas,
    'aprovador_atual', fn_wealth_user_eh_aprovador_cvm19(v_company));
END;
$function$;
