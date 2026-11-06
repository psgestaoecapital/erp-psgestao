-- RD-98 Pilar 4 (exclusão rastreável e REVERSÍVEL) para a OS de obra (/dashboard/projetos/obras/os).
-- Hoje fn_obra_os_excluir só faz soft-delete (excluido_em/por) e fn_obra_os_listar esconde o excluído:
-- uma OS cancelada e excluída some para sempre, sem lixeira nem desfazer. Esta migration é ADITIVA —
-- cria duas funções NOVAS (não altera as existentes) para listar a lixeira e restaurar a OS.
-- Code: desenvolvedor_4_g

-- Lista as OS excluídas (lixeira) da empresa, para o usuário poder restaurar.
CREATE OR REPLACE FUNCTION public.fn_obra_os_listar_excluidas(p_company_ids uuid[], p_obra_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', o.id, 'company_id', o.company_id, 'numero', o.numero, 'obra_id', o.obra_id,
      'obra_numero', ob.numero, 'obra_nome', ob.nome,
      'tarefa_id', o.tarefa_id, 'etapa', t.nome, 'obra_item_id', o.obra_item_id, 'servico', i.descricao,
      'descricao', o.descricao, 'equipe', o.equipe, 'responsavel', o.responsavel,
      'data_prevista', o.data_prevista, 'prioridade', o.prioridade, 'status', o.status,
      'iniciada_em', o.iniciada_em, 'concluida_em', o.concluida_em, 'criado_em', o.criado_em,
      'excluido_em', o.excluido_em, 'excluido_por', o.excluido_por)
    ORDER BY o.excluido_em DESC), '[]'::jsonb)
  FROM public.projetos_obra_os o
  JOIN public.projetos_obras ob ON ob.id = o.obra_id
  LEFT JOIN public.projetos_obra_tarefa t ON t.id = o.tarefa_id
  LEFT JOIN public.projetos_obra_item i ON i.id = o.obra_item_id
  WHERE auth.uid() IS NOT NULL
    AND o.excluido_em IS NOT NULL
    AND o.company_id = ANY (p_company_ids)
    AND (public.is_admin() OR o.company_id IN (SELECT public.get_user_company_ids()))
    AND (p_obra_id IS NULL OR o.obra_id = p_obra_id)
$function$;

-- Restaura (desfaz a exclusão de) uma OS de obra. Mesma guarda de empresa do excluir.
CREATE OR REPLACE FUNCTION public.fn_obra_os_restaurar(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_excluido timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre no sistema para restaurar a OS'; END IF;
  SELECT company_id, excluido_em INTO v_company, v_excluido
    FROM public.projetos_obra_os WHERE id = p_id FOR UPDATE;
  IF v_company IS NULL THEN RAISE EXCEPTION 'OS não encontrada'; END IF;
  IF v_excluido IS NULL THEN RAISE EXCEPTION 'OS não está excluída'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  UPDATE public.projetos_obra_os
     SET excluido_em = NULL, excluido_por = NULL, atualizado_em = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_obra_os_listar_excluidas(uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_obra_os_listar_excluidas(uuid[], uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_os_listar_excluidas(uuid[], uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_obra_os_restaurar(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_obra_os_restaurar(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_os_restaurar(uuid) TO authenticated;

-- RD-95: "?" dos novos controles (lixeira e restaurar). Idempotente.
INSERT INTO public.erp_ajuda_campo (rota, chave, grupo, ordem, rotulo, status, versao, vertical, exemplo, erro_comum, para_que_serve, o_que_preencher)
VALUES
  ('/dashboard/projetos/obras/os', 'projetos.os_obra.filtro_excluidas', 'Filtros', 32,
   'Ver a lixeira', 'publicado', 1, 'hub_projetos',
   'Liguei para achar a OS que apaguei por engano e trazer de volta.',
   'Esquecer que a lixeira está ligada e achar que a lista normal sumiu.',
   'Mostra as OS que foram excluídas (ficam guardadas, não somem de vez), para você poder restaurar.',
   'Ligue para ver as OS excluídas; desligue para voltar à lista normal.'),
  ('/dashboard/projetos/obras/os', 'projetos.os_obra.restaurar', 'OS de obra', 33,
   'Restaurar OS', 'publicado', 1, 'hub_projetos',
   'Restaurei a OS-2026-0012 que tinha sido excluída por engano.',
   'Procurar a OS restaurada ainda na lixeira — ela volta para a lista normal.',
   'Traz a OS excluída de volta para a lista, no mesmo estado em que estava (cancelada).',
   'Clique em Restaurar no cartão da OS excluída.')
ON CONFLICT (chave) DO NOTHING;
