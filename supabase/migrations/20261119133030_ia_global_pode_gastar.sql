-- Consultor IA — teto GLOBAL de custo de IA (decisão do CEO 17/11, RD-101).
--
-- O CEO autorizou expressamente ligar a IA (API) para a consulta de dados do Consultor, com um teto GLOBAL
-- de US$ 2,00/dia para o sistema inteiro (todas as empresas/usuários somados). Passou disso → bloqueia e a
-- tela cai no modo determinístico (Raio-X/atalhos, custo zero). Esta função é o porteiro desse teto.
--
-- Complementa (não substitui) o porteiro P0 global (anthropic_budget_control / assertIAPermitida): aquele é o
-- freeze mestre de toda IA paga; este é o teto específico da feature 'consultor_ia', medido em ia_consumo_empresa.
-- Aditiva, reversível, guardada (REVOKE anon). Não lê dado de cliente — só a soma de custo do dia.

CREATE OR REPLACE FUNCTION public.fn_ia_global_pode_gastar(p_feature text, p_custo_estimado numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_teto numeric := 2.00;   -- US$/dia, GLOBAL (todas as empresas somadas) — teto fixo, folgado p/ roteamento
  v_consumo numeric;
BEGIN
  IF COALESCE(btrim(p_feature),'') = '' THEN
    RETURN jsonb_build_object('pode', false, 'motivo', 'feature_ausente', 'consumo', 0, 'teto', v_teto);
  END IF;
  -- Soma o custo de HOJE de TODAS as empresas para esta feature (cap global, como pedido pelo CEO).
  SELECT COALESCE(SUM(custo_usd), 0) INTO v_consumo
    FROM ia_consumo_empresa
   WHERE data_referencia = current_date
     AND feature = p_feature;
  IF v_consumo + GREATEST(COALESCE(p_custo_estimado, 0), 0) > v_teto THEN
    RETURN jsonb_build_object('pode', false, 'motivo', 'teto_diario_global', 'consumo', v_consumo, 'teto', v_teto);
  END IF;
  RETURN jsonb_build_object('pode', true, 'consumo', v_consumo, 'teto', v_teto);
END $function$;

-- ACL explícita (fail-closed): nunca anon; só usuário logado e serviço (a rota chama com service_role).
REVOKE ALL ON FUNCTION public.fn_ia_global_pode_gastar(text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ia_global_pode_gastar(text, numeric) TO authenticated, service_role;
