-- ============================================================
-- Oficina · R4 — esconder R$ do operador/mecânico nas listas (dono/admin vê; operador/viewer não)
-- ============================================================
-- Varredura R4 (CEO): o #1435 fechou a home, mas 2 listas ainda devolviam dinheiro sem checar papel:
--   fn_oficina_a_faturar        → total por OS + somas
--   fn_oficina_entregues_listar → custo + receita + lucro
-- Qualquer usuário da empresa (mecânico/viewer) via esses números ao abrir a tela Entregues.
-- Doutrina #1364/#1435: dinheiro é da gestão. Whitelist quem vê: is_admin() OU papel ~ (OWNER|DONO|ADMIN).
-- Quem não vê recebe R$ = NULL + 'restrito' = true; a CONTAGEM (quantas OS) continua p/ todos (não é dinheiro).
-- (fn_oficina_custo_hora NÃO é gateada aqui: é usada internamente por fn_os_snapshot_custo_lucro e
--  fn_oficina_orcamento_precificar — gatear quebraria o cálculo quando disparado por não-dono.
--  O custo/hora é escondido no FRONT do tempário, não na RPC.)

-- 1) a_faturar: total por OS e somas só p/ quem vê dinheiro; classificação/contagens p/ todos
CREATE OR REPLACE FUNCTION public.fn_oficina_a_faturar(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_res jsonb; v_ve boolean;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  v_ve := is_admin() OR COALESCE(public.fn_oficina_papel(p_company_id) ~* '(OWNER|DONO|ADMIN)', false);
  WITH af AS (
    SELECT o.id AS os_id, o.numero, o.cliente_nome, o.cliente_id, o.placa, o.entregue_em,
           COALESCE(o.total, 0) AS total,
           (CURRENT_DATE - COALESCE(o.entregue_em::date, o.data_conclusao, o.created_at::date)) AS dias,
           CASE WHEN COALESCE(o.total,0) <= 0 THEN 'sem_valor'
                WHEN o.cliente_id IS NULL THEN 'sem_cliente' ELSE 'pronta' END AS situacao
    FROM erp_os o
    WHERE o.company_id = p_company_id AND o.status = 'entregue' AND o.excluida_em IS NULL
      AND NOT COALESCE(o.titulos_gerados, false) AND o.lancamento_id IS NULL
  )
  SELECT jsonb_build_object(
    'ok', true, 'restrito', NOT v_ve,
    'linhas', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'os_id', os_id, 'numero', numero, 'cliente_nome', cliente_nome, 'cliente_id', cliente_id,
        'placa', placa, 'entregue_em', entregue_em, 'dias', dias, 'situacao', situacao,
        'total', CASE WHEN v_ve THEN total ELSE NULL END
      ) ORDER BY dias DESC NULLS LAST, total DESC) FROM af), '[]'::jsonb),
    'totais', (SELECT jsonb_build_object(
        'qtd', COUNT(*),
        'soma_total', CASE WHEN v_ve THEN COALESCE(SUM(total), 0) ELSE NULL END,
        'mais_antiga_dias', COALESCE(MAX(dias), 0),
        'prontas', COUNT(*) FILTER (WHERE situacao = 'pronta'),
        'soma_prontas', CASE WHEN v_ve THEN COALESCE(SUM(total) FILTER (WHERE situacao = 'pronta'), 0) ELSE NULL END,
        'sem_cliente', COUNT(*) FILTER (WHERE situacao = 'sem_cliente'),
        'sem_valor', COUNT(*) FILTER (WHERE situacao = 'sem_valor')
      ) FROM af)
  ) INTO v_res;
  RETURN v_res;
END $function$;

-- 2) entregues_listar: custo/receita/lucro só p/ quem vê dinheiro; a lista e as contagens p/ todos
CREATE OR REPLACE FUNCTION public.fn_oficina_entregues_listar(p_company_id uuid, p_data_ini date DEFAULT NULL::date, p_data_fim date DEFAULT NULL::date, p_busca text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_res jsonb; v_q text := NULLIF(trim(COALESCE(p_busca,'')), ''); v_ve boolean;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  v_ve := is_admin() OR COALESCE(public.fn_oficina_papel(p_company_id) ~* '(OWNER|DONO|ADMIN)', false);
  WITH ent AS (
    SELECT o.id AS os_id, o.numero, o.entregue_em, o.cliente_nome, o.placa,
           NULLIF(trim(COALESCE(o.marca,'') || ' ' || COALESCE(o.modelo,'')), '') AS veiculo,
           COALESCE(NULLIF(trim(o.diagnostico), ''), NULLIF(trim(o.defeito_relatado), ''), '—') AS servico,
           o.tecnico_nome AS mecanico,
           COALESCE(o.custo_pecas_snapshot, 0) AS custo_pecas, COALESCE(o.custo_mao_obra_snapshot, 0) AS custo_mo,
           o.receita_snapshot AS receita, o.lucro_snapshot AS lucro,
           (o.receita_snapshot IS NULL) AS aguardando,
           o.custo_incompleto AS custo_incompleto, o.motivo_custo AS motivo_custo
    FROM erp_os o
    WHERE o.company_id = p_company_id AND o.status = 'entregue' AND o.excluida_em IS NULL
      AND (p_data_ini IS NULL OR (o.entregue_em AT TIME ZONE 'America/Sao_Paulo')::date >= p_data_ini)
      AND (p_data_fim IS NULL OR (o.entregue_em AT TIME ZONE 'America/Sao_Paulo')::date <= p_data_fim)
      AND (v_q IS NULL OR o.placa ILIKE '%'||v_q||'%' OR o.cliente_nome ILIKE '%'||v_q||'%' OR o.numero::text ILIKE '%'||v_q||'%')
  )
  SELECT jsonb_build_object(
    'ok', true, 'restrito', NOT v_ve,
    'linhas', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'os_id', os_id, 'numero', numero, 'entregue_em', entregue_em, 'cliente_nome', cliente_nome,
        'placa', placa, 'veiculo', veiculo, 'servico', servico, 'mecanico', mecanico,
        'aguardando', aguardando, 'custo_incompleto', custo_incompleto, 'motivo_custo', motivo_custo,
        'custo_pecas', CASE WHEN v_ve THEN custo_pecas ELSE NULL END,
        'custo_mo', CASE WHEN v_ve THEN custo_mo ELSE NULL END,
        'receita', CASE WHEN v_ve THEN receita ELSE NULL END,
        'lucro', CASE WHEN v_ve THEN lucro ELSE NULL END
      ) ORDER BY entregue_em DESC NULLS LAST) FROM ent), '[]'::jsonb),
    'totais', (SELECT jsonb_build_object(
        'qtd', COUNT(*),
        'custo_total', CASE WHEN v_ve THEN COALESCE(SUM(custo_pecas + custo_mo), 0) ELSE NULL END,
        'custo_pecas', CASE WHEN v_ve THEN COALESCE(SUM(custo_pecas), 0) ELSE NULL END,
        'custo_mo', CASE WHEN v_ve THEN COALESCE(SUM(custo_mo), 0) ELSE NULL END,
        'receita', CASE WHEN v_ve THEN SUM(receita) ELSE NULL END,
        'lucro', CASE WHEN v_ve THEN SUM(lucro) ELSE NULL END,
        'qtd_aguardando', COUNT(*) FILTER (WHERE aguardando),
        'qtd_custo_incompleto', COUNT(*) FILTER (WHERE custo_incompleto)
      ) FROM ent)
  ) INTO v_res;
  RETURN v_res;
END $function$;

-- 3) entregue_sem_nota (aba fiscal "sem nota"): total por OS + total_parado só p/ quem vê dinheiro;
--    a lista, contagem e o estado fiscal (faturada/tem_servico/tem_peca) continuam p/ todos.
CREATE OR REPLACE FUNCTION public.fn_os_entregue_sem_nota(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_lista jsonb; v_ve boolean;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  v_ve := is_admin() OR COALESCE(public.fn_oficina_papel(p_company_id) ~* '(OWNER|DONO|ADMIN)', false);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'os_id', o.id, 'numero', o.numero, 'cliente_nome', o.cliente_nome,
           'total', CASE WHEN v_ve THEN o.total ELSE NULL END,
           'entregue_em', o.entregue_em,
           'dias', GREATEST(0, (CURRENT_DATE - o.entregue_em::date)),
           'faturada', (COALESCE(o.titulos_gerados,false) OR o.lancamento_id IS NOT NULL),
           'tem_servico', EXISTS(SELECT 1 FROM erp_os_diagnostico_item i WHERE i.os_id=o.id AND i.tipo='servico' AND i.aprovado),
           'tem_peca', EXISTS(SELECT 1 FROM erp_os_diagnostico_item i WHERE i.os_id=o.id AND i.tipo='peca' AND i.aprovado)
         ) ORDER BY o.entregue_em ASC), '[]'::jsonb)
    INTO v_lista
  FROM erp_os o
  WHERE o.company_id = p_company_id AND o.entregue_em IS NOT NULL AND o.status NOT IN ('cancelada')
    AND NOT EXISTS (SELECT 1 FROM erp_nfe_emitidas n  WHERE n.os_id = o.id AND n.status IN ('autorizada','processando'))
    AND NOT EXISTS (SELECT 1 FROM erp_nfse_emitidas s WHERE s.os_id = o.id AND s.status IN ('autorizada','processando'));

  RETURN jsonb_build_object('ok', true, 'restrito', NOT v_ve, 'itens', v_lista,
    'total_parado', CASE WHEN v_ve THEN COALESCE((SELECT SUM((e->>'total')::numeric) FROM jsonb_array_elements(v_lista) e), 0) ELSE NULL END,
    'qtd', jsonb_array_length(v_lista));
END $function$;
