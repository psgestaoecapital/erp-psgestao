-- Hub · Oportunidades: fn_crm_pipeline passa a emitir responsavel_nome (texto legado) no card
-- Delta FC (aud8claudeps 26/10): o auditor apontou que o responsável sumia do card quando a
-- oportunidade não tem responsavel_id (usuário do ERP) — caso das DEMO (ex.: Construtora Modelo
-- b0700000-0000-4000-a000-000000000006: 3 oportunidades abertas, todas com responsavel_id NULL
-- mas responsavel_nome preenchido). A tela (OportunidadesKanban) já é forward-compatible:
--   respCard = nomeResp(responsavel_id) ?? (responsavel_nome?.trim() || null) → "Sem responsável"
-- Faltava a RPC enviar o campo. Esta migration só ACRESCENTA 'responsavel_nome' ao card.
--
-- Aditiva no payload (nenhuma coluna/grant/RLS alterada; nenhum campo removido ou renomeado);
-- CREATE OR REPLACE da função existente (via revisada). Corpo idêntico ao vivo (pg_get_functiondef),
-- exceto a nova linha do card.
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
               'responsavel_id', o.responsavel_id,
               'responsavel_nome', NULLIF(btrim(o.responsavel_nome), ''),
               'ordem', o.ordem,
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
