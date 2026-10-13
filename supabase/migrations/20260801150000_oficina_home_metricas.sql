-- RD-41 · Home da Oficina com métricas REAIS por company_id (fim dos placeholders).
-- Regra-mãe (RD-51/52/58): todo número vem do banco do tenant. Uma chamada devolve
-- tudo. Faturamento [→GE]: LÊ de erp_receber (Gestão Empresarial) — não calcula na
-- Oficina. RLS por empresa (guard get_user_company_ids / is_admin p/ PS ver o tenant).

CREATE OR REPLACE FUNCTION public.fn_oficina_home_metricas(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  SELECT jsonb_build_object(
    'ok', true,
    -- OS ativas (não entregues/canceladas) = trabalho em andamento
    'os_abertas', (SELECT count(*) FROM erp_os
       WHERE company_id = p_company_id AND status NOT IN ('entregue','cancelada','cancelado')),
    -- veículos no pátio = placas distintas em OS ativa
    'veiculos_patio', (SELECT count(DISTINCT placa) FROM erp_os
       WHERE company_id = p_company_id AND status NOT IN ('entregue','cancelada','cancelado') AND placa IS NOT NULL),
    -- OS abertas no mês corrente
    'os_mes', (SELECT count(*) FROM erp_os
       WHERE company_id = p_company_id AND date_trunc('month', created_at) = date_trunc('month', now())),
    -- [→GE] faturamento do mês: soma de contas a receber de GE (não recria financeiro aqui)
    'faturamento_mes', (SELECT COALESCE(sum(valor), 0) FROM erp_receber
       WHERE company_id = p_company_id AND deleted_at IS NULL
         AND date_trunc('month', COALESCE(data_emissao::timestamp, created_at)) = date_trunc('month', now())),
    -- prova de "em produção": última OS criada
    'ultima_atividade', (SELECT max(created_at) FROM erp_os WHERE company_id = p_company_id),
    -- clientes do tenant (real; substitui o "1" interno da PS)
    'clientes', (SELECT count(*) FROM erp_clientes WHERE company_id = p_company_id),
    -- estado real das telas da área (RD-58: sem "0%" que engana)
    'telas_total', (SELECT count(*) FROM system_screens WHERE area = 'oficina'),
    'telas_prontas', (SELECT count(*) FROM system_screens WHERE area = 'oficina' AND estado_real = 'pronto')
  ) INTO v;
  RETURN v;
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_oficina_home_metricas(uuid) TO authenticated;
