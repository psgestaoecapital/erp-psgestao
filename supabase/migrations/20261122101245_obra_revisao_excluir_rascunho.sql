-- Hub · Gestão de Obras · Revisões de escopo (RD-98 critério g: incluir/editar/excluir visíveis)
-- Auditoria de jornada (auditor_pdca_1, 2026-11-20): uma revisão em RASCUNHO criada por engano não
-- tem como ser removida na tela. O backend já tem as colunas de soft-delete (excluido_em/excluido_por/
-- motivo_exclusao) na projetos_obra_revisao e a listagem (fn_obra_revisao_listar) já filtra
-- excluido_em IS NULL — falta só a RPC de exclusão guardada e o botão na UI.
--
-- Esta migration adiciona fn_obra_revisao_excluir: SOFT-DELETE de revisão, permitido SÓ em status
-- 'rascunho' (nunca solicitada/aprovada/recusada — essas movem ou já decidiram o contrato), com guarda
-- de acesso por company_id (igual às demais fn_obra_revisao_*) e trilha em audit_log_global.
-- Aditiva: cria função nova; não altera lógica de completude/decisão existente. RD-94.1: CREATE de
-- função que grava em dado de obra = SENSÍVEL -> label revisao-eng-chefe.

CREATE OR REPLACE FUNCTION public.fn_obra_revisao_excluir(p_revisao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rev public.projetos_obra_revisao%ROWTYPE;
BEGIN
  SELECT * INTO v_rev FROM public.projetos_obra_revisao WHERE id = p_revisao_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Revisão não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_rev.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF v_rev.status <> 'rascunho' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Só uma revisão em rascunho pode ser excluída. Revisões já solicitadas, aprovadas ou recusadas ficam no histórico.');
  END IF;

  UPDATE public.projetos_obra_revisao
     SET excluido_em = now(), excluido_por = auth.uid(), atualizado_em = now()
   WHERE id = p_revisao_id;

  INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_rev.company_id, auth.uid(), 'projetos_obra_revisao', p_revisao_id::text, 'revisao_excluida',
          jsonb_build_object('status', v_rev.status, 'sequencial', v_rev.sequencial),
          jsonb_build_object('excluido_em', now()));

  RETURN jsonb_build_object('ok', true, 'revisao_id', p_revisao_id, 'excluido', true);
END; $function$;

REVOKE ALL ON FUNCTION public.fn_obra_revisao_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_revisao_excluir(uuid) TO authenticated, service_role;

-- RD-95: "?" da nova ação (chave projetos.revisao.acao_excluir).
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES (
  'projetos.revisao.acao_excluir',
  '/dashboard/projetos/obras/[id]/revisoes',
  'Revisões de escopo',
  'Excluir rascunho',
  'Clique para remover uma revisão que ainda está em Rascunho — por exemplo, criada por engano ou com itens errados.',
  'Mantém a lista limpa: só rascunhos (ainda não decididos) podem ser excluídos. Revisões já solicitadas, aprovadas ou recusadas ficam no histórico e não somem.',
  'Abriu uma revisão sem querer? Enquanto ela estiver em Rascunho, clique em "Excluir" para removê-la.',
  'Tentar excluir uma revisão já aprovada para desfazer a mudança no contrato — nesse caso, registre uma nova revisão que reverta os valores.',
  'hub_projetos', 18, 1, 'publicado'
)
ON CONFLICT (chave) DO NOTHING;
