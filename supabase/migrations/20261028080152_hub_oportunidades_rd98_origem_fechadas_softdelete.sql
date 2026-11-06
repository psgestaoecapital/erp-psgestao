-- Hub · /dashboard/projetos/oportunidades — fecha o quad RD-98 (aud8/Max 27/10, caixa 62dfbfa7 · Code: desenvolvedor_4_g)
-- Foto DEMO 0006 13:41Z: visual 93 (funil real, KPIs reconciliam, alerta de duplicata/outlier, CRUD nos cards,
-- "Gerar orçamento"). RD-95 já coberto no código (coluna_etapa/card/card_acoes/card_alerta/card_orcamento com "?",
-- ícones de ação com title+aria-label). Deltas de dado:
--   RD-98 pilar 3 (ORIGEM): a rota estava sem system_screens.views_consumidas/rpcs_chamadas (vazios).
--   RD-98 pilar 4 (EXCLUSÃO RASTREÁVEL): o funil (fn_crm_pipeline), o Kanban e a lista já filtram deleted_at IS NULL
--     e fn_crm_oportunidade_excluir faz soft-delete (deleted_at) + grava histórico (autor/ação) — já atendido.
--     ÚNICO furo: a lista de drill-down de Ganhas/Perdidas (fn_crm_oportunidades_fechadas) NÃO filtrava deleted_at,
--     então uma oportunidade excluída ainda apareceria ao abrir o tile. Corrige para ficar consistente com o resto.
--
-- Migration: a reescrita de fn_crm_oportunidades_fechadas é CREATE OR REPLACE de função existente (RD-94.1 sensível),
-- mas puramente restritiva (acrescenta "AND op.deleted_at IS NULL"); o restante é metadado de system_screens (aditivo).

-- RD-98 p4: a lista de fechadas também esconde as excluídas (soft-delete), igual ao funil
CREATE OR REPLACE FUNCTION public.fn_crm_oportunidades_fechadas(p_company_id uuid, p_etapa text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro','sem_acesso'); END IF;
  RETURN jsonb_build_object('ok', true, 'itens', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', op.id, 'titulo', op.titulo,
      'cliente_id', op.cliente_id,
      'valor', COALESCE(op.valor_proposta, op.valor_estimado, 0),
      'data_fechamento', op.data_fechamento,
      'motivo_perda', op.motivo_perda,
      'orcamento_id', op.orcamento_id,
      'responsavel', op.responsavel_nome,
      'obra', NULLIF(concat_ws(', ', op.obra_endereco, op.obra_bairro, op.obra_cidade), '')
    ) ORDER BY op.data_fechamento DESC NULLS LAST)
    FROM erp_crm_oportunidade op
    WHERE op.company_id = p_company_id AND lower(op.etapa) = lower(p_etapa)
      AND op.deleted_at IS NULL
  ), '[]'::jsonb));
END $function$;

-- RD-98 p3: origem do dado da rota de lista/Kanban (page.tsx + OportunidadesKanban + OportunidadeFormModal; sem [id])
UPDATE public.system_screens
   SET views_consumidas = ARRAY[
        'erp_crm_oportunidade',  -- funil/cards (filtra deleted_at IS NULL)
        'erp_clientes',          -- cliente da oportunidade
        'projetos_obras'         -- obra vinculada / criada ao ganhar
       ]::text[],
       rpcs_chamadas = ARRAY[
        'fn_crm_pipeline',                 -- KPIs e cards por etapa (exclui deleted_at)
        'fn_crm_mover_etapa',              -- mover card entre etapas do funil
        'fn_crm_oportunidade_ganhar',      -- "Ganhar" cria obra/orçamento
        'fn_crm_oportunidade_excluir',     -- soft-delete (deleted_at) + histórico (RD-98 p4)
        'fn_crm_oportunidades_fechadas',   -- drill-down de Ganhas/Perdidas
        'fn_crm_orcamento_do_card',        -- orçamento vinculado ao card
        'fn_crm_quem_moveu',               -- autor do último movimento
        'fn_crm_tempo_etapa',              -- tempo parado na etapa (semáforo 3/7 dias)
        'fn_oportunidade_gerar_orcamento', -- gerar orçamento a partir da oportunidade
        'fn_usuarios_da_empresa'           -- responsável/vendedor (nomes)
       ]::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/oportunidades';

-- Permissões (gate check-fn-guards): a função não fica aberta ao anon nem ao PUBLIC.
REVOKE ALL ON FUNCTION public.fn_crm_oportunidades_fechadas(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_oportunidades_fechadas(uuid, text) TO authenticated;
