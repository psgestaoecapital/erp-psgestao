-- PDCA Hub · /dashboard/projetos/desempenho (Desempenho Comercial) · aud8 80/50/65
-- GAP 1 (RD-98 p1: dado real, "dado NÃO bate com banco") · Code: desenvolvedor_4_g
--
-- fn_crm_desempenho só contava uma oportunidade como ganha/perdida no período quando
-- op.data_fechamento ESTAVA preenchida (data_fechamento BETWEEN p_de AND p_ate).
-- Muitas oportunidades marcadas 'ganho' têm data_fechamento NULL, então sumiam de
-- TODOS os períodos — os cartões (Ganhas, Ticket, Comissão, Conversão) e o funil
-- mostravam menos vendas do que o banco realmente tem.
--
-- Prova (RD-38): empresa Tryo Gesso = 23 oportunidades 'ganho', das quais 16 com
-- data_fechamento NULL (todas com updated_at). A tela mostrava só 7 ganhas; as 16
-- restantes ficavam invisíveis. (Construtora Modelo DEMO 4/4 ok; Revenda DEMO 1 ganho
-- sem fechamento.)
--
-- CORREÇÃO: usar uma data de fechamento EFETIVA
--   fech_efetiva = COALESCE(data_fechamento, updated_at::date, created_at::date)
-- para bucketizar ganhas/perdidas no período e para a velocidade média. Assim as
-- vendas fechadas sem data explícita caem na data da última mudança de etapa, e o
-- total passa a bater com o banco. 'aberta' e o funil de etapas abertas não mudam.
--
-- Aditiva: apenas CREATE OR REPLACE da função; sem DDL destrutivo, sem tocar dados,
-- sem alterar RLS/grants. Mantém SECURITY DEFINER + guarda por company/role e
-- search_path='public', inalterados.

CREATE OR REPLACE FUNCTION public.fn_crm_desempenho(p_company_ids uuid[], p_de date, p_ate date, p_vendedor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gestor boolean; v_uid uuid := auth.uid(); v_vend uuid;
  v_resumo jsonb; v_funil jsonb; v_ranking jsonb; v_perdas jsonb; v_veloc numeric;
BEGIN
  p_company_ids := ARRAY(SELECT unnest(p_company_ids) INTERSECT SELECT get_user_company_ids());
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN
    RETURN jsonb_build_object('erro','sem_acesso'); END IF;
  v_gestor := is_admin()
    OR EXISTS (SELECT 1 FROM tenant_user_roles t WHERE t.user_id=v_uid AND t.company_id = ANY(p_company_ids)
                 AND t.is_active AND t.role IN ('CLIENT_OWNER','CLIENT_MANAGER'))
    OR (SELECT role FROM users WHERE id=v_uid) IN ('acesso_total','adm','socio');
  v_vend := CASE WHEN v_gestor THEN p_vendedor ELSE v_uid END;
  DROP TABLE IF EXISTS _crm_base;
  CREATE TEMP TABLE _crm_base ON COMMIT DROP AS
    SELECT op.id, op.etapa, op.responsavel_id, op.responsavel_nome, op.motivo_perda, op.created_at, op.data_fechamento,
           COALESCE(op.data_fechamento, op.updated_at::date, op.created_at::date) AS fech_efetiva,
           COALESCE(op.valor_proposta, op.valor_estimado, 0) AS valor_deal,
           (op.etapa NOT IN ('ganho','perdido')) AS aberta,
           (op.etapa='ganho'   AND COALESCE(op.data_fechamento, op.updated_at::date, op.created_at::date) BETWEEN p_de AND p_ate) AS ganha_periodo,
           (op.etapa='perdido' AND COALESCE(op.data_fechamento, op.updated_at::date, op.created_at::date) BETWEEN p_de AND p_ate) AS perdida_periodo,
           o.comissao_percentual AS comissao_pct
    FROM erp_crm_oportunidade op LEFT JOIN erp_orcamentos o ON o.id = op.orcamento_id
    WHERE op.company_id = ANY(p_company_ids) AND (v_vend IS NULL OR op.responsavel_id = v_vend);
  SELECT jsonb_build_object(
      'oportunidades', count(*), 'valor_pipeline', COALESCE(sum(valor_deal) FILTER (WHERE aberta),0),
      'propostas', count(*) FILTER (WHERE etapa IN ('proposta_enviada','negociacao','ganho','perdido')),
      'ganhas_qtd', count(*) FILTER (WHERE ganha_periodo), 'ganhas_valor', COALESCE(sum(valor_deal) FILTER (WHERE ganha_periodo),0),
      'perdidas_qtd', count(*) FILTER (WHERE perdida_periodo), 'perdidas_valor', COALESCE(sum(valor_deal) FILTER (WHERE perdida_periodo),0),
      'ticket_medio', CASE WHEN count(*) FILTER (WHERE ganha_periodo)>0 THEN round(COALESCE(sum(valor_deal) FILTER (WHERE ganha_periodo),0)/count(*) FILTER (WHERE ganha_periodo),2) ELSE 0 END,
      'comissao', COALESCE(sum(valor_deal*COALESCE(comissao_pct,0)/100) FILTER (WHERE ganha_periodo),0),
      'conversao_pct', CASE WHEN (count(*) FILTER (WHERE ganha_periodo)+count(*) FILTER (WHERE perdida_periodo))>0 THEN round(100.0*count(*) FILTER (WHERE ganha_periodo)/(count(*) FILTER (WHERE ganha_periodo)+count(*) FILTER (WHERE perdida_periodo)),1) ELSE NULL END)
  INTO v_resumo FROM _crm_base WHERE aberta OR ganha_periodo OR perdida_periodo;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('etapa',etapa,'qtd',qtd,'valor',valor) ORDER BY ord),'[]'::jsonb) INTO v_funil FROM (
    SELECT e.etapa, e.ord, count(b.id) qtd, COALESCE(sum(b.valor_deal),0) valor
    FROM (VALUES ('prospeccao',1),('visita_agendada',2),('visita_feita',3),('orcando',4),('proposta_enviada',5),('negociacao',6),('ganho',7),('perdido',8)) e(etapa,ord)
    LEFT JOIN _crm_base b ON b.etapa=e.etapa AND (b.aberta OR (e.etapa='ganho' AND b.ganha_periodo) OR (e.etapa='perdido' AND b.perdida_periodo))
    GROUP BY e.etapa,e.ord) f;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('motivo',motivo,'qtd',qtd,'valor',valor) ORDER BY valor DESC),'[]'::jsonb) INTO v_perdas FROM (
    SELECT COALESCE(NULLIF(btrim(motivo_perda),''),'(sem motivo)') motivo, count(*) qtd, COALESCE(sum(valor_deal),0) valor
    FROM _crm_base WHERE perdida_periodo GROUP BY 1) p;
  SELECT round(avg(fech_efetiva - created_at::date),1) INTO v_veloc FROM _crm_base WHERE ganha_periodo AND created_at IS NOT NULL;
  IF v_gestor THEN
    SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'ganhas_valor')::numeric DESC),'[]'::jsonb) INTO v_ranking FROM (
      SELECT jsonb_build_object(
        'responsavel_id', responsavel_id, 'responsavel_nome', COALESCE(NULLIF(btrim(max(responsavel_nome)),''),'(sem responsável)'),
        'oportunidades', count(*), 'propostas', count(*) FILTER (WHERE etapa IN ('proposta_enviada','negociacao','ganho','perdido')),
        'ganhas', count(*) FILTER (WHERE ganha_periodo), 'ganhas_valor', COALESCE(sum(valor_deal) FILTER (WHERE ganha_periodo),0),
        'ticket', CASE WHEN count(*) FILTER (WHERE ganha_periodo)>0 THEN round(COALESCE(sum(valor_deal) FILTER (WHERE ganha_periodo),0)/count(*) FILTER (WHERE ganha_periodo),2) ELSE 0 END,
        'comissao', COALESCE(sum(valor_deal*COALESCE(comissao_pct,0)/100) FILTER (WHERE ganha_periodo),0),
        'conversao_pct', CASE WHEN (count(*) FILTER (WHERE ganha_periodo)+count(*) FILTER (WHERE perdida_periodo))>0 THEN round(100.0*count(*) FILTER (WHERE ganha_periodo)/(count(*) FILTER (WHERE ganha_periodo)+count(*) FILTER (WHERE perdida_periodo)),1) ELSE NULL END) AS r
      FROM _crm_base WHERE aberta OR ganha_periodo OR perdida_periodo GROUP BY responsavel_id) x;
  ELSE v_ranking := NULL; END IF;
  DROP TABLE IF EXISTS _crm_base;
  RETURN jsonb_build_object('gestor', v_gestor, 'de', p_de, 'ate', p_ate, 'vendedor', v_vend,
    'resumo', v_resumo, 'funil', v_funil, 'ranking', v_ranking, 'perdas', v_perdas, 'velocidade_dias', v_veloc);
END; $function$;

-- Guarda check_fn_guards (regra 1 revoke_anon): REVOKE explícito idêntico à ACL viva (zero mudança funcional).
REVOKE ALL ON FUNCTION public.fn_crm_desempenho(uuid[], date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_desempenho(uuid[], date, date, uuid) TO authenticated, service_role;
