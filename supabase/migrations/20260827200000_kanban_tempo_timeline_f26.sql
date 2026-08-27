-- SPEC F2.6 · KANBAN COM TEMPO + LINHA DO TEMPO DA OBRA · Hub de Projetos.
-- Nada persiste de novo (RD-26): tempo/histórico saem de erp_crm_oportunidade_historico e
-- erp_orcamento_historico, que já gravam quem/quando. Genérico (qualquer empresa/funil).
-- Auditado 27/08 (RD-44/45): erp_crm_oportunidade_historico NÃO tem deleted_at; colunas
-- criado_por/area_total_m2 (erp_obra_planta), responsavel_id (erp_crm_visita), created_by
-- (projetos_obras) e v_users_with_roles(user_id,full_name,email) conferem.

-- ENTREGA 1a · tempo por etapa (semáforo 3/7 dias — mesmo padrão do Kanban P&M, RD-52)
CREATE OR REPLACE FUNCTION public.fn_crm_tempo_etapa(p_company_id uuid)
RETURNS TABLE (oportunidade_id uuid, etapa text, desde timestamptz, dias_na_etapa int,
  dias_desde_criacao int, origem text, semaforo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  WITH base AS (
    SELECT o.id, o.etapa, o.created_at,
           (SELECT max(h.criado_em) FROM erp_crm_oportunidade_historico h
             WHERE h.oportunidade_id = o.id AND h.para_etapa = o.etapa) AS ultima_entrada
      FROM erp_crm_oportunidade o
     WHERE o.company_id = p_company_id AND o.deleted_at IS NULL
       AND o.company_id IN (SELECT get_user_company_ids())
  )
  SELECT b.id, b.etapa,
    COALESCE(b.ultima_entrada, b.created_at) AS desde,
    EXTRACT(DAY FROM now() - COALESCE(b.ultima_entrada, b.created_at))::int AS dias_na_etapa,
    EXTRACT(DAY FROM now() - b.created_at)::int AS dias_desde_criacao,
    CASE WHEN b.ultima_entrada IS NULL THEN 'created_at' ELSE 'historico' END AS origem,
    CASE WHEN EXTRACT(DAY FROM now() - COALESCE(b.ultima_entrada, b.created_at)) >= 7 THEN 'vermelho'
         WHEN EXTRACT(DAY FROM now() - COALESCE(b.ultima_entrada, b.created_at)) >= 3 THEN 'amarelo'
         ELSE 'verde' END AS semaforo
  FROM base b;
$fn$;
REVOKE ALL ON FUNCTION public.fn_crm_tempo_etapa(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_crm_tempo_etapa(uuid) TO authenticated;

-- ENTREGA 2 · quem moveu por último (autor_nome quase sempre nulo → JOIN em v_users_with_roles)
CREATE OR REPLACE FUNCTION public.fn_crm_quem_moveu(p_company_id uuid)
RETURNS TABLE (oportunidade_id uuid, autor_id uuid, autor_nome text, acao text, quando timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT DISTINCT ON (h.oportunidade_id)
         h.oportunidade_id, h.autor_id,
         COALESCE(NULLIF(btrim(h.autor_nome),''), u.full_name, u.email, '—') AS autor_nome,
         h.acao, h.criado_em
    FROM erp_crm_oportunidade_historico h
    LEFT JOIN v_users_with_roles u ON u.user_id = h.autor_id
   WHERE h.company_id = p_company_id
     AND h.company_id IN (SELECT get_user_company_ids())
     AND h.acao IN ('etapa_mudou','criada','ganha','perdida','retornou_funil')
   ORDER BY h.oportunidade_id, h.criado_em DESC;
$fn$;
REVOKE ALL ON FUNCTION public.fn_crm_quem_moveu(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_crm_quem_moveu(uuid) TO authenticated;

-- ENTREGA 4a · linha do tempo unificada da obra (oportunidade → visita → planta → orçamento → obra)
CREATE OR REPLACE FUNCTION public.fn_obra_linha_do_tempo(p_obra_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_obra record; v_eventos jsonb;
BEGIN
  SELECT * INTO v_obra FROM projetos_obras WHERE id = p_obra_id;
  IF v_obra.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'obra_nao_encontrada'); END IF;
  IF v_obra.company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  WITH ev AS (
    SELECT h.criado_em AS quando, 'oportunidade' AS fase, h.acao AS tipo, h.detalhe AS descricao, h.autor_id
      FROM erp_crm_oportunidade_historico h WHERE h.oportunidade_id = v_obra.oportunidade_id
    UNION ALL
    SELECT COALESCE(v.data_visita, v.created_at), 'levantamento', 'visita_' || v.status,
           'Visita técnica ' || v.status || COALESCE(' · ' || NULLIF(btrim(v.anotacoes),''), ''), v.responsavel_id
      FROM erp_crm_visita v WHERE v.oportunidade_id = v_obra.oportunidade_id
    UNION ALL
    SELECT p.created_at, 'levantamento', 'planta_' || COALESCE(p.status,'enviada'),
           'Planta ' || COALESCE(p.nome,'') || COALESCE(' · ' || p.area_total_m2::text || ' m²', ''), p.criado_por
      FROM erp_obra_planta p WHERE p.orcamento_id = v_obra.orcamento_id
    UNION ALL
    SELECT oh.created_at, 'orcamento', oh.evento, COALESCE(oh.detalhe, oh.evento), oh.usuario_id
      FROM erp_orcamento_historico oh WHERE oh.orcamento_id = v_obra.orcamento_id
    UNION ALL
    SELECT v_obra.created_at, 'obra', 'obra_criada',
           'Obra ' || v_obra.numero || ' criada a partir do orçamento', v_obra.created_by
    UNION ALL
    SELECT v_obra.escopo_congelado_em, 'obra', 'escopo_congelado',
           'Escopo congelado · ' || (SELECT count(*)::text FROM projetos_obra_item i WHERE i.obra_id = v_obra.id AND i.excluido_em IS NULL) || ' itens',
           v_obra.created_by
     WHERE v_obra.escopo_congelado_em IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'quando', ev.quando, 'fase', ev.fase, 'tipo', ev.tipo, 'descricao', ev.descricao,
           'autor', COALESCE(u.full_name, u.email, '—')
         ) ORDER BY ev.quando), '[]'::jsonb)
  INTO v_eventos FROM ev LEFT JOIN v_users_with_roles u ON u.user_id = ev.autor_id
  WHERE ev.quando IS NOT NULL;
  RETURN jsonb_build_object('ok', true,
    'obra', jsonb_build_object('id', v_obra.id, 'numero', v_obra.numero, 'nome', v_obra.nome,
      'cliente', v_obra.cliente_nome, 'status', v_obra.status,
      'valor_previsto', v_obra.valor_previsto, 'valor_medido', v_obra.valor_medido,
      'centro_custo_id', v_obra.centro_custo_id, 'data_inicio', v_obra.data_inicio),
    'eventos', v_eventos, 'total_eventos', jsonb_array_length(v_eventos));
END $fn$;
REVOKE ALL ON FUNCTION public.fn_obra_linha_do_tempo(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_obra_linha_do_tempo(uuid) TO authenticated;
