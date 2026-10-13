-- Tryo #110 + #262 (Oportunidades). O card do kanban passa a trazer o telefone do cliente (#110: "o vendedor localizar
-- o cliente quando precisar"); a tela mostra o NOME DO CLIENTE em destaque e a descrição do serviço embaixo (#262).
--
-- Segurança (achado 30/09): fn_crm_pipeline é SECURITY DEFINER e não conferia se a empresa pedida é do usuário — um
-- logado lia o funil de qualquer empresa passando outro company_id. Ganha a guarda da PR A2b (sem usuário = serviço
-- passa; logado precisa ser admin ou a empresa estar em get_user_company_ids()). Só leitura; nada é gravado.
CREATE OR REPLACE FUNCTION public.fn_crm_pipeline(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- PR A2b (CEO 28/09): a empresa tem de ser do usuário (sem usuário = serviço/cron passa)
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND (p_company_id IS NULL OR p_company_id NOT IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'etapas', (SELECT jsonb_agg(e) FROM (
      SELECT o.etapa, count(*) AS qtd, COALESCE(sum(o.valor_estimado),0) AS valor_total,
             jsonb_agg(jsonb_build_object(
               'id', o.id, 'titulo', o.titulo,
               'cliente', COALESCE(c.nome_fantasia, c.razao_social),
               'cliente_telefone', NULLIF(COALESCE(NULLIF(btrim(c.celular),''), NULLIF(btrim(c.whatsapp),''), NULLIF(btrim(c.telefone),'')), ''),
               'valor_estimado', o.valor_estimado, 'probabilidade', o.probabilidade,
               'responsavel_id', o.responsavel_id, 'ordem', o.ordem,
               'data_prevista', o.data_prevista_fechamento) ORDER BY o.ordem) AS cards
      FROM erp_crm_oportunidade o LEFT JOIN erp_clientes c ON c.id=o.cliente_id
      WHERE o.company_id=p_company_id AND o.deleted_at IS NULL AND o.etapa NOT IN ('ganho','perdido')
      GROUP BY o.etapa) e),
    'resumo', (SELECT jsonb_build_object(
      'abertas', count(*) FILTER (WHERE etapa NOT IN ('ganho','perdido')),
      'ganhas_mes', count(*) FILTER (WHERE etapa='ganho' AND data_fechamento >= date_trunc('month', now())),
      'valor_pipeline', COALESCE(sum(valor_estimado) FILTER (WHERE etapa NOT IN ('ganho','perdido')),0))
      FROM erp_crm_oportunidade WHERE company_id=p_company_id AND deleted_at IS NULL)
  );
END $function$;

REVOKE ALL ON FUNCTION public.fn_crm_pipeline(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_pipeline(uuid) TO authenticated, service_role;
