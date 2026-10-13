-- ============================================================
-- Oficina · R4 — faturamento na home só para dono/admin (o mecânico não vê dinheiro)
-- ============================================================
-- Brecha R4 (apontada pelo CEO em 12/09): fn_oficina_home_metricas devolvia faturamento_mes
-- (SUM erp_receber) com guard só de get_user_company_ids()/is_admin() — ou seja, QUALQUER usuário
-- da empresa (mecânico/viewer/operador) via o faturamento ao abrir a home da oficina.
-- Mesma doutrina do #1364/precificar/registrar: valor é da gestão, não do operador.
--
-- Fix: faturamento_mes só quando is_admin() OU papel_gestao é de DONO/ADMIN (OWNER/DONO/ADMIN);
-- para os demais (OPERATOR/VIEWER/MECANICO) vem NULL + faturamento_restrito=true, e a tela esconde
-- o card. Leitura por papel — não escreve nada. Assinatura inalterada (sem overload).
-- Confirmado em prod: CEO=CLIENT_OWNER (vê), Gean=OFICINA_DONO (vê, é dono), viewer=CLIENT_VIEWER (não vê).

CREATE OR REPLACE FUNCTION public.fn_oficina_home_metricas(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb; v_ve_faturamento boolean;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  -- quem vê dinheiro: admin da plataforma, ou papel de dono/gestão da empresa (OWNER/DONO/ADMIN).
  -- operador/viewer/mecânico NÃO veem (R4).
  v_ve_faturamento := is_admin() OR COALESCE(public.fn_oficina_papel(p_company_id) ~* '(OWNER|DONO|ADMIN)', false);

  SELECT jsonb_build_object(
    'ok', true,
    'os_abertas', (SELECT count(*) FROM erp_os
       WHERE company_id = p_company_id AND status NOT IN ('entregue','cancelada','cancelado')),
    'veiculos_patio', (SELECT count(DISTINCT placa) FROM erp_os
       WHERE company_id = p_company_id AND status NOT IN ('entregue','cancelada','cancelado') AND placa IS NOT NULL),
    'os_mes', (SELECT count(*) FROM erp_os
       WHERE company_id = p_company_id AND date_trunc('month', created_at) = date_trunc('month', now())),
    -- R4: faturamento só para quem pode ver dinheiro
    'faturamento_mes', CASE WHEN v_ve_faturamento THEN (SELECT COALESCE(sum(valor), 0) FROM erp_receber
       WHERE company_id = p_company_id AND deleted_at IS NULL
         AND date_trunc('month', COALESCE(data_emissao::timestamp, created_at)) = date_trunc('month', now()))
       ELSE NULL END,
    'faturamento_restrito', NOT v_ve_faturamento,
    'ultima_atividade', (SELECT max(created_at) FROM erp_os WHERE company_id = p_company_id),
    'clientes', (SELECT count(*) FROM erp_clientes WHERE company_id = p_company_id),
    'telas_total', (SELECT count(*) FROM system_screens WHERE area = 'oficina'),
    'telas_prontas', (SELECT count(*) FROM system_screens WHERE area = 'oficina' AND estado_real = 'pronto')
  ) INTO v;
  RETURN v;
END $function$;
