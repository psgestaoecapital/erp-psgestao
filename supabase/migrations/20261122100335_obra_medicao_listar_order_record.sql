-- P1 PRODUÇÃO (Hub): /dashboard/projetos/obras/[id]/medicoes quebrada em TODAS as empresas.
-- Causa (RD-38, prova no banco com BEGIN/ROLLBACK): fn_obra_medicao_listar falhava com
-- 42883 "operator does not exist: record ->> unknown" — o ORDER BY da agregação usava
-- (m->>'numero')::int sobre o REGISTRO da subconsulta (m), não sobre jsonb. Veio na
-- migration 20261120050045_obra_medicao_retencao_inss_iss_irrf.sql (#5262).
-- Correção: ordenar por m.numero DESC (coluna do próprio registro). Nada mais muda.
-- Aditiva: só CREATE OR REPLACE da função; não toca dado de cliente.
-- Prova: a obra 0e995085-560d-4f30-be11-99a4cfdb9608 (Construtora Modelo - DEMO) lista a
-- medição nº 1 (aprovada) sem erro (ver e2e @pos-migration).

CREATE OR REPLACE FUNCTION public.fn_obra_medicao_listar(p_obra_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_out jsonb;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada.'); END IF;
  PERFORM public.fn__guarda_empresa(v_company);

  SELECT COALESCE(jsonb_agg(row_to_json(m)::jsonb ORDER BY m.numero DESC), '[]'::jsonb) INTO v_out
  FROM (
    SELECT md.id, md.numero, md.tipo, md.competencia, md.status, md.valor_total, md.observacoes,
           md.inss_pct, md.iss_pct, md.irrf_pct, md.valor_retido, md.valor_liquido,
           md.aprovada_em, md.criado_em,
           (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                     'obra_item_id', mi.obra_item_id, 'descricao', it.descricao,
                     'percentual', mi.percentual, 'quantidade', mi.quantidade, 'valor', mi.valor,
                     'valor_contratado', COALESCE(it.valor_contratado, COALESCE(it.preco_unitario,0)*COALESCE(it.quantidade_contratada,0))
                   ) ORDER BY it.ordem NULLS LAST), '[]'::jsonb)
              FROM public.projetos_obra_medicao_item mi
              JOIN public.projetos_obra_item it ON it.id = mi.obra_item_id
             WHERE mi.medicao_id = md.id AND mi.excluido_em IS NULL) AS itens
      FROM public.projetos_obra_medicao md
     WHERE md.obra_id = p_obra_id AND md.excluido_em IS NULL
  ) m;

  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id, 'medicoes', v_out);
END $function$;
