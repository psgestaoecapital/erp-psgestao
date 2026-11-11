-- #6723 (cliente): "preciso limpar essa lista para iniciar o mês... não estou achando lugar para excluir estes orçamentos."
-- RD-98 critério g (incluir/EDITAR/EXCLUIR visíveis) + exclusão rastreável. Aditiva: cria 1 função nova e 1 chave de ajuda.
-- Não altera dado de cliente de forma destrutiva — a exclusão é LÓGICA (deleted_at/deleted_by/motivo_exclusao, colunas que
-- já existem na erp_orcamentos) e recusa orçamento que já virou pedido (documento financeiro não se apaga).
-- Guarda por empresa (get_user_company_ids/is_admin), motivo obrigatório, rastro em audit_log_global. Espelha fn_obra_excluir.

CREATE OR REPLACE FUNCTION public.fn_orcamento_excluir(p_orcamento_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_o public.erp_orcamentos%ROWTYPE;
  v_motivo text := NULLIF(btrim(p_motivo), '');
BEGIN
  SELECT * INTO v_o FROM public.erp_orcamentos WHERE id = p_orcamento_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Orçamento não encontrado');
  END IF;
  -- guarda por empresa: get_user_company_ids()/is_admin() (ancoram o check-fn-guards)
  IF NOT (v_o.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  IF v_motivo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o motivo da exclusão.');
  END IF;
  -- documento financeiro não se apaga: orçamento que virou pedido fica
  IF v_o.pedido_id IS NOT NULL OR v_o.convertido_em IS NOT NULL OR v_o.status = 'convertido' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Este orçamento já virou pedido — não pode ser excluído. Para encerrá-lo mantendo o histórico, cancele o pedido.');
  END IF;

  UPDATE public.erp_orcamentos
     SET deleted_at = now(), deleted_by = auth.uid(), motivo_exclusao = v_motivo, updated_at = now()
   WHERE id = p_orcamento_id;

  BEGIN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_o.company_id, auth.uid(), (SELECT email FROM users WHERE id = auth.uid()), 'erp_orcamentos', v_o.id::text, 'EXCLUIU',
            jsonb_build_object('numero', v_o.numero, 'status', v_o.status, 'cliente_nome', v_o.cliente_nome, 'total', v_o.total),
            jsonb_build_object('acao', 'soft_delete', 'motivo', v_motivo));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'numero', v_o.numero);
END $function$;

REVOKE ALL ON FUNCTION public.fn_orcamento_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_orcamento_excluir(uuid, text) TO authenticated, service_role;

-- RD-95: "?" da ação Excluir na lista de orçamentos
INSERT INTO public.erp_ajuda_campo (rota, chave, grupo, ordem, rotulo, status, versao, vertical, para_que_serve, o_que_preencher, exemplo, erro_comum)
VALUES (
  '/dashboard/orcamentos', 'orcamentos.acao.excluir', 'Orçamento', 0, 'Excluir orçamento', 'publicado', 1, 'gestao_empresarial',
  'Remove o orçamento da lista para limpar a tela (ex.: começar o mês). É uma exclusão rastreável: o orçamento sai da lista mas fica guardado no histórico de auditoria, com quem excluiu e o motivo — não é apagado de verdade. Orçamento que já virou pedido não pode ser excluído, porque vira documento financeiro.',
  'Toque em "Excluir" na linha do orçamento e informe o motivo. Só aparece em orçamento que ainda NÃO virou pedido.',
  'Para zerar a lista de rascunhos antigos antes de iniciar novembro, exclua cada orçamento de teste informando o motivo "limpeza de rascunhos".',
  'Tentar excluir um orçamento já convertido em pedido: o sistema recusa para não apagar um documento financeiro. Nesse caso, cancele o pedido.'
)
ON CONFLICT (chave) DO NOTHING;
