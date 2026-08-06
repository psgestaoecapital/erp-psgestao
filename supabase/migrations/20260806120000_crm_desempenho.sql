-- RD-41 · Hub · Desempenho Comercial por vendedor. Pré-req (FIX B: motivo de perda obrigatório) + a RPC
-- do painel. RD-26: reusa erp_crm_oportunidade + erp_orcamentos (comissao) + motivo_perda. RD-38: tudo do
-- banco por período. Pilar 2: vendedor só vê o seu (a RPC força o escopo por papel).

-- FIX B · marcar 'perdido' EXIGE motivo. FIX A/C já ok (etapas existem; data_fechamento já é setada).
CREATE OR REPLACE FUNCTION public.fn_crm_mover_etapa(p_id uuid, p_etapa text, p_motivo_perda text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid;
BEGIN
  SELECT company_id INTO v_comp FROM erp_crm_oportunidade WHERE id=p_id;
  IF v_comp IS NULL OR v_comp NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok',false,'erro','Sem permissao');
  END IF;
  IF p_etapa='perdido' AND COALESCE(btrim(p_motivo_perda),'')='' THEN
    RETURN jsonb_build_object('ok',false,'erro','motivo_obrigatorio',
      'orientacao','Para marcar como Perdido, informe o motivo da perda.');
  END IF;
  UPDATE erp_crm_oportunidade SET
    etapa=p_etapa,
    data_fechamento = CASE WHEN p_etapa IN ('ganho','perdido') THEN now()::date ELSE data_fechamento END,
    motivo_perda = CASE WHEN p_etapa='perdido' THEN p_motivo_perda ELSE motivo_perda END,
    updated_at=now()
  WHERE id=p_id;
  RETURN jsonb_build_object('ok',true,'etapa',p_etapa);
END; $function$;

-- Painel: resumo + funil por fase + ranking (gestor) + perdas por motivo + velocidade. Escopo por papel.
CREATE OR REPLACE FUNCTION public.fn_crm_desempenho(
  p_company_ids uuid[], p_de date, p_ate date, p_vendedor uuid DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

  -- base numa temp (CTE não sobrevive entre statements). Recriada a cada chamada.
  DROP TABLE IF EXISTS _crm_base;
  CREATE TEMP TABLE _crm_base ON COMMIT DROP AS
    SELECT op.id, op.etapa, op.responsavel_id, op.responsavel_nome, op.motivo_perda, op.created_at, op.data_fechamento,
           COALESCE(op.valor_proposta, op.valor_estimado, 0) AS valor_deal,
           (op.etapa NOT IN ('ganho','perdido')) AS aberta,
           (op.etapa='ganho'   AND op.data_fechamento BETWEEN p_de AND p_ate) AS ganha_periodo,
           (op.etapa='perdido' AND op.data_fechamento BETWEEN p_de AND p_ate) AS perdida_periodo,
           o.comissao_percentual AS comissao_pct
    FROM erp_crm_oportunidade op
    LEFT JOIN erp_orcamentos o ON o.id = op.orcamento_id
    WHERE op.company_id = ANY(p_company_ids)
      AND (v_vend IS NULL OR op.responsavel_id = v_vend);

  -- Bloco A · resumo (só as linhas do período: abertas OU fechadas no intervalo)
  SELECT jsonb_build_object(
      'oportunidades', count(*),
      'valor_pipeline', COALESCE(sum(valor_deal) FILTER (WHERE aberta),0),
      'propostas', count(*) FILTER (WHERE etapa IN ('proposta_enviada','negociacao','ganho','perdido')),
      'ganhas_qtd', count(*) FILTER (WHERE ganha_periodo),
      'ganhas_valor', COALESCE(sum(valor_deal) FILTER (WHERE ganha_periodo),0),
      'perdidas_qtd', count(*) FILTER (WHERE perdida_periodo),
      'perdidas_valor', COALESCE(sum(valor_deal) FILTER (WHERE perdida_periodo),0),
      'ticket_medio', CASE WHEN count(*) FILTER (WHERE ganha_periodo)>0
        THEN round(COALESCE(sum(valor_deal) FILTER (WHERE ganha_periodo),0)/count(*) FILTER (WHERE ganha_periodo),2) ELSE 0 END,
      'comissao', COALESCE(sum(valor_deal*COALESCE(comissao_pct,0)/100) FILTER (WHERE ganha_periodo),0),
      'conversao_pct', CASE WHEN (count(*) FILTER (WHERE ganha_periodo)+count(*) FILTER (WHERE perdida_periodo))>0
        THEN round(100.0*count(*) FILTER (WHERE ganha_periodo)/(count(*) FILTER (WHERE ganha_periodo)+count(*) FILTER (WHERE perdida_periodo)),1) ELSE NULL END)
  INTO v_resumo FROM _crm_base WHERE aberta OR ganha_periodo OR perdida_periodo;

  -- Bloco B · funil por fase
  SELECT COALESCE(jsonb_agg(jsonb_build_object('etapa',etapa,'qtd',qtd,'valor',valor) ORDER BY ord),'[]'::jsonb)
  INTO v_funil FROM (
    SELECT e.etapa, e.ord, count(b.id) qtd, COALESCE(sum(b.valor_deal),0) valor
    FROM (VALUES ('prospeccao',1),('visita_feita',2),('proposta_enviada',3),('negociacao',4),('ganho',5),('perdido',6)) e(etapa,ord)
    LEFT JOIN _crm_base b ON b.etapa=e.etapa
      AND (b.aberta OR (e.etapa='ganho' AND b.ganha_periodo) OR (e.etapa='perdido' AND b.perdida_periodo))
    GROUP BY e.etapa,e.ord
  ) f;

  -- Bloco D · perdas por motivo (no período)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('motivo',motivo,'qtd',qtd,'valor',valor) ORDER BY valor DESC),'[]'::jsonb)
  INTO v_perdas FROM (
    SELECT COALESCE(NULLIF(btrim(motivo_perda),''),'(sem motivo)') motivo, count(*) qtd, COALESCE(sum(valor_deal),0) valor
    FROM _crm_base WHERE perdida_periodo GROUP BY 1
  ) p;

  -- Bloco E · velocidade média (dias) das ganhas no período
  SELECT round(avg(data_fechamento - created_at::date),1) INTO v_veloc
  FROM _crm_base WHERE ganha_periodo AND created_at IS NOT NULL;

  -- Bloco C · ranking por vendedor (só gestor)
  IF v_gestor THEN
    SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'ganhas_valor')::numeric DESC),'[]'::jsonb) INTO v_ranking FROM (
      SELECT jsonb_build_object(
        'responsavel_id', responsavel_id,
        'responsavel_nome', COALESCE(NULLIF(btrim(max(responsavel_nome)),''),'(sem responsável)'),
        'oportunidades', count(*),
        'propostas', count(*) FILTER (WHERE etapa IN ('proposta_enviada','negociacao','ganho','perdido')),
        'ganhas', count(*) FILTER (WHERE ganha_periodo),
        'ganhas_valor', COALESCE(sum(valor_deal) FILTER (WHERE ganha_periodo),0),
        'ticket', CASE WHEN count(*) FILTER (WHERE ganha_periodo)>0
          THEN round(COALESCE(sum(valor_deal) FILTER (WHERE ganha_periodo),0)/count(*) FILTER (WHERE ganha_periodo),2) ELSE 0 END,
        'comissao', COALESCE(sum(valor_deal*COALESCE(comissao_pct,0)/100) FILTER (WHERE ganha_periodo),0),
        'conversao_pct', CASE WHEN (count(*) FILTER (WHERE ganha_periodo)+count(*) FILTER (WHERE perdida_periodo))>0
          THEN round(100.0*count(*) FILTER (WHERE ganha_periodo)/(count(*) FILTER (WHERE ganha_periodo)+count(*) FILTER (WHERE perdida_periodo)),1) ELSE NULL END) AS r
      FROM _crm_base WHERE aberta OR ganha_periodo OR perdida_periodo
      GROUP BY responsavel_id
    ) x;
  ELSE v_ranking := NULL; END IF;

  DROP TABLE IF EXISTS _crm_base;
  RETURN jsonb_build_object(
    'gestor', v_gestor, 'de', p_de, 'ate', p_ate, 'vendedor', v_vend,
    'resumo', v_resumo, 'funil', v_funil, 'ranking', v_ranking,
    'perdas', v_perdas, 'velocidade_dias', v_veloc);
END; $function$;

GRANT EXECUTE ON FUNCTION public.fn_crm_desempenho(uuid[],date,date,uuid) TO authenticated;
