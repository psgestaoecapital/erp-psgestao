-- NFE-F5 · ENTREGA 5 — Painel "Reforma Tributária: o que já está chegando".
-- SÓ INFORMATIVO (RD-51): mostra o IBS/CBS que JÁ VEIO nas compras — não simula carga futura nem alíquota
-- (as alíquotas ainda estão em definição). Mostrar o que chegou, não prever.
--
-- Fonte: erp_nfe_recebidas_itens_tributo (tributo in 'ibs','cbs'), extraído na Fase 1. Não depende de receita
-- (por isso desbloqueado enquanto a apuração espera a KGF emitir pelo PS).
--
-- Medido KGF (RD-38): IBS R$35,74 + CBS R$322,00 = R$357,74 · 200 de 208 notas completas com os campos novos ·
-- 17 de 24 fornecedores já emitindo com IBS/CBS.

CREATE OR REPLACE FUNCTION public.fn_fiscal_reforma_painel(p_company_id uuid, p_competencia text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_out jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;

  WITH rc AS (
    SELECT n.id AS nfe_id, n.emitente_cnpj, to_char(n.data_emissao,'YYYY-MM') AS mes,
           sum(CASE WHEN t.tributo='ibs' THEN t.valor ELSE 0 END) AS ibs,
           sum(CASE WHEN t.tributo='cbs' THEN t.valor ELSE 0 END) AS cbs,
           max(CASE WHEN t.tributo IN ('ibs','cbs') THEN 1 ELSE 0 END) AS tem_reforma
    FROM erp_nfe_recebidas n
    JOIN erp_nfe_recebidas_itens i ON i.nfe_recebida_id = n.id
    JOIN erp_nfe_recebidas_itens_tributo t ON t.item_id = i.id
    WHERE n.company_id = p_company_id AND n.status = 'completa'
      AND (p_competencia IS NULL OR to_char(n.data_emissao,'YYYY-MM') = p_competencia)
    GROUP BY n.id, n.emitente_cnpj, to_char(n.data_emissao,'YYYY-MM')
  )
  SELECT jsonb_build_object(
    'ok', true, 'competencia', COALESCE(p_competencia,'todas'),
    'ibs_total', COALESCE((SELECT round(sum(ibs),2) FROM rc),0),
    'cbs_total', COALESCE((SELECT round(sum(cbs),2) FROM rc),0),
    'ibs_cbs_total', COALESCE((SELECT round(sum(ibs+cbs),2) FROM rc),0),
    'notas_com_reforma', (SELECT count(*) FROM rc WHERE tem_reforma=1),
    'notas_total', (SELECT count(*) FROM rc),
    'fornecedores_com_reforma', (SELECT count(DISTINCT emitente_cnpj) FROM rc WHERE tem_reforma=1),
    'fornecedores_total', (SELECT count(DISTINCT emitente_cnpj) FROM rc),
    'por_mes', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'mes') FROM (
        SELECT jsonb_build_object('mes', mes, 'ibs', round(sum(ibs),2), 'cbs', round(sum(cbs),2),
               'ibs_cbs', round(sum(ibs+cbs),2), 'notas_com_reforma', count(*) FILTER (WHERE tem_reforma=1)) AS x
        FROM rc GROUP BY mes) m), '[]'::jsonb),
    'aviso', 'Informativo — mostra o IBS/CBS que já chegou nas suas compras. Não simula carga futura nem alíquota (ainda em definição). O que chegou, não uma previsão.'
  ) INTO v_out;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_fiscal_reforma_painel(uuid,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_reforma_painel(uuid,text) TO authenticated, service_role;
