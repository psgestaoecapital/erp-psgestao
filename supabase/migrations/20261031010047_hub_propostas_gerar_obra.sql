-- Hub · Propostas — ação "Gerar obra" na lista (auditor 29/10: ganhar proposta tem de abrir a obra num toque).
-- ADITIVA: 1 RPC nova com guarda de empresa; reaproveita fn_obra_criar_de_orcamento (idempotente, congela o escopo,
-- cria centro de custo). Só proposta APROVADA / que virou pedido e ainda SEM obra. Nenhum dado existente é alterado.

CREATE OR REPLACE FUNCTION public.fn_proposta_gerar_obra(p_orcamento_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE o public.erp_orcamentos%ROWTYPE; v_obra public.projetos_obras%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.erp_orcamentos WHERE id = p_orcamento_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proposta não encontrada.'; END IF;
  PERFORM public.fn__guarda_empresa(o.company_id);
  IF o.status NOT IN ('aprovado', 'convertido') THEN
    RAISE EXCEPTION 'Só proposta aprovada vira obra. Aprove a proposta no editor primeiro.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.projetos_obras WHERE orcamento_id = p_orcamento_id) OR o.obra_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta proposta já tem obra.';
  END IF;
  v_obra := public.fn_obra_criar_de_orcamento(p_orcamento_id);
  IF v_obra.id IS NULL THEN
    RAISE EXCEPTION 'O módulo Obras não está ativo para esta empresa.';
  END IF;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (o.company_id, auth.uid(), 'erp_orcamentos', p_orcamento_id::text, 'gerar_obra',
            jsonb_build_object('numero', o.numero, 'status', o.status),
            jsonb_build_object('obra_id', v_obra.id, 'obra_numero', v_obra.numero));
  RETURN jsonb_build_object('ok', true, 'obra_id', v_obra.id, 'obra_numero', v_obra.numero);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_proposta_gerar_obra(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_proposta_gerar_obra(uuid) TO authenticated, service_role;

UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY['fn_proposta_excluir', 'fn_proposta_gerar_obra']
 WHERE rota = '/dashboard/projetos/propostas';

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT * FROM (VALUES
  ('projetos.propostas.gerar_obra', '/dashboard/projetos/propostas', 'Propostas', 'Gerar obra',
   'Aparece só em proposta aprovada que ainda não tem obra. Um toque cria a obra com o escopo e o valor da proposta.', 'Fecha o elo ganhar → executar: a obra nasce com os itens congelados e o centro de custo.', 'Proposta 0123 aprovada → obra OBRA-2026-0007', 'Esperar que a obra apareça sozinha: se a proposta foi aprovada sem obra, use este botão.', 'hub', 964, 1, 'publicado')
) AS t(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = t.chave);
