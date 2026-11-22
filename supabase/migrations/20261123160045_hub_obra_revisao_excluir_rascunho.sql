-- Hub · Obras · Revisões de escopo (RD-98 critério g: incluir/editar/EXCLUIR visíveis)
-- Gap da auditoria de jornada (auditor_pdca_1, 20/11): uma revisão em RASCUNHO criada por
-- engano não tinha como ser removida na tela. O backend já suporta soft-delete
-- (projetos_obra_revisao.excluido_em/_por/motivo_exclusao) e fn_obra_revisao_listar já
-- filtra excluido_em IS NULL — faltava a RPC guardada de exclusão e o "?" da ação.
-- Aditiva: cria função NOVA e 1 chave de ajuda NOVA. Não altera dado de cliente.
-- Guarda igual às irmãs (_solicitar/_recusar): RLS por company, só status='rascunho',
-- audit_log_global. Code: desenvolvedor_4_g.

CREATE OR REPLACE FUNCTION public.fn_obra_revisao_excluir(p_revisao_id uuid, p_motivo text DEFAULT NULL::text)
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
    RETURN jsonb_build_object('ok', false, 'erro', 'Só uma revisão em rascunho pode ser excluída.');
  END IF;

  UPDATE public.projetos_obra_revisao
     SET excluido_em = now(),
         excluido_por = auth.uid(),
         motivo_exclusao = NULLIF(btrim(p_motivo), ''),
         atualizado_em = now()
   WHERE id = p_revisao_id;

  INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_rev.company_id, auth.uid(), 'projetos_obra_revisao', p_revisao_id::text, 'revisao_excluida',
          jsonb_build_object('status', 'rascunho', 'sequencial', v_rev.sequencial),
          jsonb_build_object('excluido', true, 'motivo', NULLIF(btrim(p_motivo), '')));

  RETURN jsonb_build_object('ok', true, 'revisao_id', p_revisao_id, 'status', 'excluida');
END; $function$;

REVOKE ALL ON FUNCTION public.fn_obra_revisao_excluir(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_revisao_excluir(uuid, text) TO authenticated, service_role;

-- RD-95: "?" da ação nova
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.revisao.acao_excluir',
   '/dashboard/projetos/obras/[id]/revisoes',
   'Revisões de escopo',
   'Excluir revisão',
   'Remove da lista uma revisão que ainda está em Rascunho — por exemplo, criada por engano ou com quantidade errada. O registro não é apagado do banco: fica guardado com quem excluiu, quando e o motivo (exclusão rastreável). Informe o motivo (opcional).',
   'Permite corrigir um rascunho indevido sem poluir a lista de revisões, mantendo o histórico para auditoria.',
   'Exclua um rascunho que você abriu sem querer, antes de solicitar a aprovação.',
   'Tentar excluir uma revisão já Solicitada ou Aprovada — só uma revisão em Rascunho pode ser excluída.',
   'hub_projetos', 20, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
