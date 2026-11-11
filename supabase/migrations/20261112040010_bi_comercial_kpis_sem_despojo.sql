-- BI Comercial · R$/kg SEM DESPOJO nos KPIs (CEO 10/11, decisão confirmada e provada).
--
-- Definição: "sem despojo" = carne + miúdo (flag `carne` da bi_comercial_venda_item_mv); exclui as linhas
-- INATIVOS e SUBPRODUTOS BOVINOS. Frioeste 01/10–06/11: R$ 13.505.181,57 ÷ 441.159,139 kg = R$ 30,6129/kg.
--
-- Antes: o card "R$ por kg" dividia o faturamento TOTAL pelo kg TOTAL (R$ 18,62), número sem sentido comercial.
-- Agora: ganham três campos novos (faturamento_sem_despojo, volume_kg_sem_despojo, ticket_kg_sem_despojo). Os campos
-- antigos (volume_kg, faturamento, ticket_kg, ...) continuam iguais, para a tela de inteligência não quebrar.
-- Mesma assinatura, mesma guarda de escopo (fn_bi_comercial_scope), mesma fonte (bi_comercial_venda_item_mv).

CREATE OR REPLACE FUNCTION public.fn_bi_comercial_kpis(p_company_id uuid, p_dt_ini date, p_dt_fim date, p_vendedor text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_scope jsonb; v_vend text; r RECORD;
BEGIN
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' = 'sem_acesso' THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial'); END IF;
  v_vend := CASE WHEN v_scope->>'modo' = 'vendedor' THEN v_scope->>'cod' ELSE p_vendedor END;
  SELECT COALESCE(SUM(m.kg), 0) AS volume_kg,
         COALESCE(SUM(m.valor), 0) AS faturamento,
         COUNT(DISTINCT m.cliente_cod) AS clientes,
         COUNT(DISTINCT upper(translate(split_part(m.cidade, '/', 1), 'ÁÀÂÃÉÈÊÍÌÓÒÔÕÚÙÇáàâãéèêíìóòôõúùç', 'AAAAEEEIIOOOUUCaaaaeeeiiooouuc'))) AS cidades,
         COALESCE(SUM(m.kg) FILTER (WHERE c.status = 'entra'), 0) AS kg_com_selecao,
         COALESCE(SUM(m.valor) FILTER (WHERE c.status = 'entra'), 0) AS faturamento_com_selecao,
         COALESCE(SUM(m.valor) FILTER (WHERE m.carne), 0) AS faturamento_sem_despojo,
         COALESCE(SUM(m.kg) FILTER (WHERE m.carne), 0) AS volume_kg_sem_despojo
    INTO r
    FROM public.bi_comercial_venda_item_mv m
    LEFT JOIN public.bi_comercial_produto_classificacao c ON c.company_id = m.company_id AND c.cod_produto = m.produto_cod
   WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini AND p_dt_fim
     AND (v_vend IS NULL OR m.vendedor = v_vend);
  RETURN jsonb_build_object('ok', true, 'escopo', v_scope->>'modo', 'vendedor', v_vend,
    'volume_kg', r.volume_kg, 'faturamento', r.faturamento, 'clientes', r.clientes, 'cidades', r.cidades,
    'ticket_kg', ROUND(r.faturamento / NULLIF(r.volume_kg, 0), 4),
    'ticket_cliente', ROUND(r.faturamento / NULLIF(r.clientes, 0), 2),
    'faturamento_com_selecao', r.faturamento_com_selecao,
    'volume_kg_com_selecao', r.kg_com_selecao,
    'ticket_kg_com_selecao', ROUND(r.faturamento_com_selecao / NULLIF(r.kg_com_selecao, 0), 4),
    'faturamento_sem_despojo', r.faturamento_sem_despojo,
    'volume_kg_sem_despojo', r.volume_kg_sem_despojo,
    'ticket_kg_sem_despojo', ROUND(r.faturamento_sem_despojo / NULLIF(r.volume_kg_sem_despojo, 0), 4),
    'lucro', NULL, 'margem_pct', NULL, 'lucro_status', 'aguardando_dado_confiavel', 'fonte', 'venda_item_aceite');
END
$fn$;

REVOKE ALL ON FUNCTION public.fn_bi_comercial_kpis(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_kpis(uuid, date, date, text) TO authenticated, service_role;
