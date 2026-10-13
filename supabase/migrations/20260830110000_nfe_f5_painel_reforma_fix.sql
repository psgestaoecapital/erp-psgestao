-- NFE-F5 · correção do Painel da Reforma (feedback do CEO): distinguir NOTAS COM O CAMPO IBS/CBS (200) de
-- NOTAS COM VALOR > 0 (189). As outras 11 têm o grupo IBS/CBS mas valor zero — se o card mostra só "200" ou
-- só "189" vira número que ninguém reconcilia. A função passa a devolver os DOIS; a tela mostra ambos.

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
           max(CASE WHEN t.tributo IN ('ibs','cbs') THEN 1 ELSE 0 END) AS tem_campo
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
    -- DOIS números distintos (não confundir): notas que TÊM o grupo IBS/CBS vs notas com VALOR > 0
    'notas_com_campo', (SELECT count(*) FROM rc WHERE tem_campo=1),
    'notas_com_valor', (SELECT count(*) FROM rc WHERE (ibs+cbs) > 0),
    'notas_total', (SELECT count(*) FROM rc),
    'fornecedores_com_campo', (SELECT count(DISTINCT emitente_cnpj) FROM rc WHERE tem_campo=1),
    'fornecedores_total', (SELECT count(DISTINCT emitente_cnpj) FROM rc),
    'por_mes', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'mes') FROM (
        SELECT jsonb_build_object('mes', mes, 'ibs', round(sum(ibs),2), 'cbs', round(sum(cbs),2),
               'ibs_cbs', round(sum(ibs+cbs),2),
               'notas_com_valor', count(*) FILTER (WHERE (ibs+cbs) > 0)) AS x
        FROM rc GROUP BY mes) m), '[]'::jsonb),
    'aviso', 'Informativo — mostra o IBS/CBS que já chegou nas suas compras. A variação mês a mês é mix de compras, não "adoção da Reforma". Não simula carga futura nem alíquota (ainda em definição).'
  ) INTO v_out;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_fiscal_reforma_painel(uuid,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_reforma_painel(uuid,text) TO authenticated, service_role;

-- ── registro no menu (RD-26: o slot commerce_reforma_tributaria JÁ EXISTE no catálogo, só estava inativo) ──
-- grupo commerce, subgrupo compras. A rota do slot é /dashboard/commerce/reforma — a tela é movida pra lá.
UPDATE public.module_catalog
   SET ativo = true, subgrupo = 'compras'
 WHERE id = 'commerce_reforma_tributaria';

-- ativar por tenant (o passo que "escondeu a tela do logo por três PRs": ativo no catálogo NÃO basta,
-- precisa de tenant_modules_active). Ativa para a KGF (a empresa do F5); idempotente.
INSERT INTO public.tenant_modules_active (company_id, module_id, is_active, override_reason, activated_at)
SELECT 'a462e13f-0f51-4c54-abe8-4474b591633b', 'commerce_reforma_tributaria', true, 'NFE-F5 Painel da Reforma', now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.tenant_modules_active
  WHERE company_id='a462e13f-0f51-4c54-abe8-4474b591633b' AND module_id='commerce_reforma_tributaria');
UPDATE public.tenant_modules_active SET is_active = true, deactivated_at = NULL
 WHERE company_id='a462e13f-0f51-4c54-abe8-4474b591633b' AND module_id='commerce_reforma_tributaria';
