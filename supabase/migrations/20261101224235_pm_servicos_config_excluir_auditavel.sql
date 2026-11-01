-- PDCA P&M · /dashboard/pm/servicos (auditor_pdca_2 / aud8, 31/10, provado no dado RD-38)
-- Item 1 (RD-98 p4 — exclusão rastreável): fn_agency_config_excluir apagava a opção de lista
-- (agency_config_opcao) com DELETE físico, SEM registrar quem excluiu nem gravar em audit_log_global.
-- Correção: grava auth.uid() + o valor anterior em audit_log_global (ação 'config_opcao_excluida') ANTES
-- do DELETE, espelhando o rastro de fn_agency_servico_excluir.
--   Por que mantém o DELETE (e não soft-delete como no serviço): agency_config_opcao tem índice ÚNICO
--   (company_id, lista, valor) e é lida por 6 funções (listar/salvar/pauta/trigger); um soft-delete exigiria
--   índice parcial + filtro em todas elas e quebraria o re-cadastro do mesmo valor. A opção só é removível
--   quando comprovadamente SEM USO (checagens preservadas abaixo), então a rastreabilidade pelo audit_log_global
--   é suficiente e proporcional. Aditiva ao comportamento; guardas (is_admin/get_user_company_ids) preservadas.
-- Item 2 (RD-95): novas chaves de ajuda "?" para as ações do serviço e para o modal de opções.
--
-- RD-38 (prova no dado, BEGIN…ROLLBACK, statement_timeout curto): INSERT de uma opção 'unidade' sem uso na
-- empresa DEMO P&M → o caminho de exclusão grava audit_log_global (acao='config_opcao_excluida', registro_id =
-- id da opção) e remove a opção; ROLLBACK sem resíduo. audit_criado=true confirmado.

CREATE OR REPLACE FUNCTION public.fn_agency_config_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_row agency_config_opcao%ROWTYPE; v_qtd int := 0; v_col text; v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO v_row FROM agency_config_opcao WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'opcao não encontrada'); END IF;
  IF NOT is_admin() AND v_row.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;

  v_col := CASE v_row.lista WHEN 'area_equipe' THEN 'area' WHEN 'unidade' THEN 'unidade' WHEN 'periodicidade' THEN 'periodicidade' ELSE NULL END;
  IF v_col IS NOT NULL THEN
    EXECUTE format('SELECT count(*) FROM agency_servico WHERE company_id = $1 AND %I = $2', v_col)
      INTO v_qtd USING v_row.company_id, v_row.valor;
    IF v_qtd > 0 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'opcao_em_uso', 'qtd', v_qtd); END IF;
  END IF;
  IF v_row.lista = 'rede_social' THEN
    SELECT count(*) INTO v_qtd FROM agency_posts
     WHERE company_id = v_row.company_id AND v_row.valor = ANY (redes) AND excluido_em IS NULL;
    IF v_qtd > 0 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'opcao_em_uso', 'qtd', v_qtd,
        'mensagem', 'Rede usada em posts. Oculte a rede em vez de remover.'); END IF;
  END IF;

  -- RD-98 p4: rastro de quem excluiu + valor anterior ANTES do DELETE físico (a opção já está comprovadamente sem uso).
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_row.company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'agency_config_opcao', p_id::text,
          'config_opcao_excluida',
          jsonb_build_object('lista', v_row.lista, 'valor', v_row.valor, 'rotulo', v_row.rotulo, 'ativo', v_row.ativo),
          jsonb_build_object('excluido', true, 'excluido_por', v_uid));

  DELETE FROM agency_config_opcao WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- Guarda de função (check-fn-guards): SECURITY DEFINER só para quem está logado (CREATE OR REPLACE preserva grants,
-- mas a régua exige o REVOKE anon explícito na migration nova).
REVOKE EXECUTE ON FUNCTION public.fn_agency_config_excluir(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_agency_config_excluir(uuid) TO authenticated;

-- RD-95: "?" das ações do serviço e do modal de gerenciar opções.
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('pm.servico.acoes','/dashboard/pm/servicos','Serviço','Ações do serviço',
  'Nada a preencher: são as ações de cada serviço da lista — Editar, Duplicar e Excluir.',
  'Editar ajusta o serviço; Duplicar cria uma cópia editável; Excluir remove (ou, se o serviço já estiver em uso, apenas o desativa, preservando o histórico).',
  'Use Duplicar para criar um serviço parecido sem redigitar tudo.',
  'Excluir um serviço em uso não apaga o histórico: ele é desativado e some das novas propostas.',
  'pm', 20, 'publicado'),
 ('pm.servico.opcoes','/dashboard/pm/servicos','Serviço','Opções da lista',
  'Gerencie aqui os valores da lista (Área/equipe, Unidade ou Periodicidade): adicionar, renomear, ativar/inativar ou excluir.',
  'Centraliza as opções que aparecem nos campos de seleção do serviço, para toda a empresa usar os mesmos termos.',
  'Adicione a unidade "post" ou a periodicidade "quinzenal" para reutilizar em vários serviços.',
  'Excluir uma opção em uso é bloqueado — inative para parar de oferecê-la sem quebrar os serviços existentes.',
  'pm', 21, 'publicado'),
 ('pm.servico.opcao_nome','/dashboard/pm/servicos','Serviço','Nome da opção',
  'O rótulo da opção como aparece na seleção. Edite e saia do campo para salvar.',
  'Renomeia a opção em todos os lugares que a usam, sem precisar recadastrar.',
  'Troque "Mensal" por "Mensal (30 dias)" para ficar mais claro na proposta.',
  'Renomear não muda o valor interno já gravado nos serviços; só o texto exibido.',
  'pm', 22, 'publicado'),
 ('pm.servico.opcao_ativa','/dashboard/pm/servicos','Serviço','Opção ativa/inativa',
  'Alterna a opção entre Ativa e Inativa.',
  'Opção inativa some das novas seleções, mas continua válida nos serviços que já a usam.',
  'Inative uma unidade que a agência parou de vender.',
  'Inativar não exclui: para remover de vez, use o ✕ (só quando sem uso).',
  'pm', 23, 'publicado'),
 ('pm.servico.opcao_excluir','/dashboard/pm/servicos','Serviço','Excluir opção',
  'Nada a preencher: remove a opção da lista.',
  'Tira definitivamente uma opção que ninguém usa; a exclusão fica registrada (quem e quando) no log de auditoria.',
  'Remova uma opção criada por engano.',
  'Se algum serviço usa a opção, a exclusão é bloqueada — inative em vez de excluir.',
  'pm', 24, 'publicado'),
 ('pm.servico.opcao_nova','/dashboard/pm/servicos','Serviço','Nova opção',
  'Digite o nome da nova opção e confirme para adicioná-la à lista.',
  'Cria um novo valor reutilizável nos campos de seleção do serviço.',
  'Adicione a área "Design" ou a unidade "campanha".',
  'Evite duplicar uma opção que já existe com outro texto — padronize os nomes.',
  'pm', 25, 'publicado')
ON CONFLICT (chave) DO NOTHING;
