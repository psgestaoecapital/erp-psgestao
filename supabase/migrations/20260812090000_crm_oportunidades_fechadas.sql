-- ============================================================
-- FIX (Angélica/Tryo) — Kanban Oportunidades: ver Ganhas/Perdidas.
-- Ao marcar Ganho/Perdido o card sai do kanban (ok), mas os totais "Ganhas/Perdidas" não
-- listavam nada — a operadora não achava o cliente nem o orçamento. RPC que lista as fechadas
-- (etapa='ganho'|'perdido') com cliente_id, valor, data, motivo da perda e orcamento_id.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_crm_oportunidades_fechadas(
  p_company_id uuid, p_etapa text)   -- p_etapa = 'ganho' | 'perdido'
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
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
  ), '[]'::jsonb));
END $f$;
