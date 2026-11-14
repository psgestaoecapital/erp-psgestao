-- RD-98 p2/p4 · Oficina › Comissão › Regras de comissão: faltava EXCLUIR/DESATIVAR a regra.
-- A lista de regras era somente leitura (só INCLUIR). O "Editar" é resolvido no front reusando o
-- fn_oficina_comissao_regra_salvar (que já substitui a regra ativa do mesmo mecânico). Aqui entra
-- só a exclusão rastreável: NOVA RPC guardada de soft-delete (ativo=false) + trilha em audit_log_global.
-- Aditiva: não altera nenhuma função/tabela existente; a coluna "ativo" já existe na tabela.

CREATE OR REPLACE FUNCTION public.fn_oficina_comissao_regra_desativar(p_company_id uuid, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_old jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;

  SELECT to_jsonb(r.*) INTO v_old
    FROM erp_oficina_comissao_regra r
   WHERE r.id = p_id AND r.company_id = p_company_id AND r.ativo = true;

  IF v_old IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'regra_nao_encontrada');
  END IF;

  UPDATE erp_oficina_comissao_regra SET ativo = false
   WHERE id = p_id AND company_id = p_company_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'erp_oficina_comissao_regra', p_id::text, 'desativar',
          v_old, jsonb_build_object('ativo', false));

  RETURN jsonb_build_object('ok', true, 'id', p_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_oficina_comissao_regra_desativar(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_oficina_comissao_regra_desativar(uuid, uuid) TO authenticated;

-- RD-95: ajuda ("?") das novas ações da tela.
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('oficina.comissao.regra_editar', '/dashboard/oficina/comissao', 'Oficina', 'Editar regra',
  'Botão que traz a regra para o formulário abaixo, para você ajustar o tipo e o valor.',
  'Corrige a regra de um mecânico (ou a padrão) sem recadastrar do zero; ao salvar, a regra ativa daquele mecânico é substituída pela nova.',
  'Tocar em "Editar" na regra do mecânico, mudar o percentual e tocar em "Salvar regra".',
  'Trocar o nome do mecânico ao editar cria uma regra nova para o outro nome, em vez de corrigir a atual.',
  'oficina', 9, 1, 'publicado'),
 ('oficina.comissao.regra_excluir', '/dashboard/oficina/comissao', 'Oficina', 'Excluir regra',
  'Botão que desativa a regra de comissão selecionada.',
  'Tira a regra do cálculo a partir de agora; o histórico fica guardado (a regra é desativada, não apagada) e o mecânico volta a aparecer como "sem regra".',
  'Tocar em "Excluir" na regra que não vale mais.',
  'Excluir a regra padrão deixa sem cálculo todos os mecânicos que não têm regra própria.',
  'oficina', 10, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
