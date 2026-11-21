-- Hub · Gestão de Obras · Revisões de escopo (RD-98 critério g: editar visível)
-- Auditoria de jornada (auditor_pdca_1, 2026-11-20): uma revisão em RASCUNHO (criada com itens/motivo
-- errados) só podia ser Solicitada ou Excluída — não dava para CORRIGIR antes de solicitar.
--
-- fn_obra_revisao_editar: reescreve motivo/origem e os itens (quantidade_nova/preco_unitario_novo) de
-- uma revisão SÓ em status 'rascunho', recomputando valor_anterior/valor_novo. Mesma validação de PISO
-- do medido e mesma guarda por company_id da fn_obra_revisao_criar. Rebuild dos itens (delete+insert) é
-- seguro: rascunho ainda não tocou o contrato. Aditiva: cria função nova, não altera as existentes.
-- RD-94.1: CREATE de função que grava em dado de obra = SENSÍVEL -> label revisao-eng-chefe.

CREATE OR REPLACE FUNCTION public.fn_obra_revisao_editar(
  p_revisao_id uuid, p_motivo text, p_origem text DEFAULT 'interno'::text, p_itens jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rev public.projetos_obra_revisao%ROWTYPE;
  v_obra public.projetos_obras%ROWTYPE;
  v_item jsonb; v_oi public.projetos_obra_item%ROWTYPE;
  v_val_ant numeric := 0; v_val_novo numeric := 0; v_qtd_nova numeric; v_preco_novo numeric;
BEGIN
  IF p_origem NOT IN ('interno','pedido_cliente') THEN RETURN jsonb_build_object('ok',false,'erro','origem inválida'); END IF;
  SELECT * INTO v_rev FROM public.projetos_obra_revisao WHERE id = p_revisao_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','Revisão não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_rev.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE='42501';
  END IF;
  IF v_rev.status <> 'rascunho' THEN
    RETURN jsonb_build_object('ok',false,'erro','Só uma revisão em rascunho pode ser editada. Revisões já solicitadas, aprovadas ou recusadas não mudam.');
  END IF;

  SELECT * INTO v_obra FROM public.projetos_obras WHERE id = v_rev.obra_id;

  -- Rebuild dos itens do rascunho
  DELETE FROM public.projetos_obra_revisao_item WHERE revisao_id = p_revisao_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_itens,'[]'::jsonb)) LOOP
    SELECT * INTO v_oi FROM public.projetos_obra_item WHERE id = (v_item->>'obra_item_id')::uuid AND company_id = v_rev.company_id;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_qtd_nova := NULLIF(v_item->>'quantidade_nova','')::numeric;
    v_preco_novo := COALESCE(NULLIF(v_item->>'preco_unitario_novo','')::numeric, v_oi.preco_unitario);
    IF v_qtd_nova IS NOT NULL AND v_qtd_nova < COALESCE(v_oi.quantidade_medida,0) THEN
      RAISE EXCEPTION 'Item %: quantidade revisada % abaixo do medido %', v_oi.descricao, v_qtd_nova, COALESCE(v_oi.quantidade_medida,0)
        USING ERRCODE='23514';
    END IF;
    INSERT INTO public.projetos_obra_revisao_item(
      company_id, revisao_id, obra_item_id, descricao, unidade,
      quantidade_anterior, quantidade_nova, preco_unitario_anterior, preco_unitario_novo,
      quantidade_medida_na_revisao, motivo)
    VALUES (v_rev.company_id, p_revisao_id, v_oi.id, v_oi.descricao, v_oi.unidade,
      v_oi.quantidade_contratada, v_qtd_nova, v_oi.preco_unitario, v_preco_novo,
      COALESCE(v_oi.quantidade_medida,0), v_item->>'motivo');
    v_val_ant  := v_val_ant  + COALESCE(v_oi.quantidade_contratada,0) * COALESCE(v_oi.preco_unitario,0);
    v_val_novo := v_val_novo + COALESCE(v_qtd_nova, v_oi.quantidade_contratada,0) * COALESCE(v_preco_novo,0);
  END LOOP;

  UPDATE public.projetos_obra_revisao
     SET motivo = p_motivo, origem = p_origem, valor_anterior = v_val_ant, valor_novo = v_val_novo, atualizado_em = now()
   WHERE id = p_revisao_id;

  INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_rev.company_id, auth.uid(), 'projetos_obra_revisao', p_revisao_id::text, 'revisao_editada',
          jsonb_build_object('motivo', v_rev.motivo, 'valor_novo', v_rev.valor_novo),
          jsonb_build_object('motivo', p_motivo, 'valor_novo', v_val_novo));

  RETURN jsonb_build_object('ok',true,'revisao_id',p_revisao_id,'valor_anterior',v_val_ant,'valor_novo',v_val_novo);
END; $function$;

REVOKE ALL ON FUNCTION public.fn_obra_revisao_editar(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_revisao_editar(uuid, text, text, jsonb) TO authenticated, service_role;

-- RD-95: "?" da nova ação (chave projetos.revisao.acao_editar).
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES (
  'projetos.revisao.acao_editar',
  '/dashboard/projetos/obras/[id]/revisoes',
  'Revisões de escopo',
  'Editar rascunho',
  'Clique para reabrir o formulário de uma revisão em Rascunho e corrigir o motivo, a origem ou as novas quantidades/preços dos itens antes de solicitar aprovação.',
  'Permite ajustar uma revisão ainda em rascunho sem precisar excluir e recomeçar. Só rascunhos podem ser editados — depois de solicitada, a revisão não muda.',
  'Digitou a quantidade errada num item? Enquanto a revisão estiver em Rascunho, clique em "Editar", corrija e salve.',
  'Esperar editar uma revisão já aprovada — nesse caso o contrato já mudou; registre uma nova revisão para ajustar.',
  'hub_projetos', 19, 1, 'publicado'
)
ON CONFLICT (chave) DO NOTHING;
