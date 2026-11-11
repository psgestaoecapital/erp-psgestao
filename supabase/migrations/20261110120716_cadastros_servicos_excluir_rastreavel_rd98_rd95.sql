-- Cadastros · Serviços (/dashboard/cadastros/servicos) — gaps do auditor (score 85):
--  1. RD-95: 0 AjudaCampo "?" nas colunas (Código/LC 116/% ISS/Valor), busca e ações.
--  2. Coluna CÓDIGO "—": o código é campo OPCIONAL (interno); o "?" esclarece (nem todo serviço tem).
--  3. RD-98 p4: exclusão RASTREÁVEL (soft-delete + audit_log) — a tela só tinha Clonar/Editar, sem excluir.
--
-- Esta migration entrega o núcleo seguro do gap 3 (RPCs auditadas) + as chaves de ajuda do gap 1/2.
-- A tela passa a chamar fn_erp_servico_excluir/_reativar e a ter filtro de situação (ativos/inativos/todos).
--
-- IMPORTANTE (RD-26): já existe fn_servico_excluir, mas ela opera em projetos_servicos (serviços do Hub),
-- NÃO em erp_servicos (catálogo de NFS-e desta tela). Por isso uma RPC própria para erp_servicos.
-- ADITIVA: funções NOVAS + linhas NOVAS de ajuda. Nada apaga/altera dado existente (soft-delete = ativo=false).

-- ── Exclusão lógica rastreável (RD-98 p4) ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_erp_servico_excluir(p_servico_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- guarda de empresa (fail-closed): só age em empresa do próprio usuário
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  UPDATE erp_servicos SET ativo = false, updated_at = now()
   WHERE id = p_servico_id AND company_id = p_company_id AND ativo = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  END IF;
  -- RD-98 p4: trilha central de auditoria com o autor
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (p_company_id, auth.uid(), 'erp_servicos', p_servico_id::text, 'inativar',
            jsonb_build_object('ativo', false, 'em', now()));
  RETURN jsonb_build_object('ok', true);
END $function$;
REVOKE ALL ON FUNCTION public.fn_erp_servico_excluir(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_erp_servico_excluir(uuid, uuid) TO authenticated;

-- ── Reativação rastreável (desfaz a exclusão lógica) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_erp_servico_reativar(p_servico_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  UPDATE erp_servicos SET ativo = true, updated_at = now()
   WHERE id = p_servico_id AND company_id = p_company_id AND ativo = false;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  END IF;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (p_company_id, auth.uid(), 'erp_servicos', p_servico_id::text, 'reativar',
            jsonb_build_object('ativo', true, 'em', now()));
  RETURN jsonb_build_object('ok', true);
END $function$;
REVOKE ALL ON FUNCTION public.fn_erp_servico_reativar(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_erp_servico_reativar(uuid, uuid) TO authenticated;

-- ── RD-95: chaves de ajuda da tela ──────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('cadastros.servicos.busca','Serviços','Buscar serviço',
 'Digite parte da descrição, do código ou da categoria para filtrar a lista.',
 'Acha rápido um serviço no catálogo sem rolar tudo; a busca é no servidor (lista grande não trava).',
 '"consultoria" · "17.01" · "manutenção".',
 'Digitar o código completo com pontos quando foi cadastrado sem pontos: busque por parte do texto.',
 1,'/dashboard/cadastros/servicos','gestao_empresarial','publicado'),
('cadastros.servicos.novo','Serviços','Novo Serviço',
 'Ação: abre o formulário para cadastrar um novo serviço do catálogo de NFS-e.',
 'Cria o serviço com descrição, classificação fiscal (LC 116) e retenções para emitir nota.',
 'Cadastrar "Consultoria em TI" com LC 116 1.07.',
 'Cadastrar o mesmo serviço duas vezes: use Clonar para variações e a busca antes de criar.',
 2,'/dashboard/cadastros/servicos','gestao_empresarial','publicado'),
('cadastros.servicos.filtro_situacao','Serviços','Situação',
 'Filtra a lista por situação: Ativos (padrão), Inativos (excluídos logicamente) ou Todos.',
 'Permite rever e reativar serviços que foram excluídos — a exclusão é lógica, nada se perde.',
 'Trocar para "Inativos" para reativar um serviço arquivado por engano.',
 'Procurar um serviço excluído em "Ativos": ele só aparece em Inativos/Todos.',
 3,'/dashboard/cadastros/servicos','gestao_empresarial','publicado'),
('cadastros.servicos.col_codigo','Serviços','Código',
 'Coluna (não se preenche aqui). Código interno OPCIONAL do serviço, definido no cadastro. "—" quando não informado.',
 'Ajuda a referenciar o serviço em sistemas internos; não é obrigatório para emitir nota.',
 'SERV-001 · vazio ("—").',
 'Achar que "—" é erro: o código é opcional; preencha no cadastro se a empresa usar codificação própria.',
 4,'/dashboard/cadastros/servicos','gestao_empresarial','publicado'),
('cadastros.servicos.col_descricao','Serviços','Descrição',
 'Coluna (não se preenche aqui). A descrição resumida do serviço e, abaixo, a categoria.',
 'Identifica o serviço na lista e é a base do que vai para a NFS-e.',
 'Consultoria em TI · categoria "Tecnologia".',
 'Descrição genérica demais: dificulta achar e sair na nota com clareza.',
 5,'/dashboard/cadastros/servicos','gestao_empresarial','publicado'),
('cadastros.servicos.col_lc116','Serviços','LC 116',
 'Coluna (não se preenche aqui). O código da Lista de Serviços da Lei Complementar 116/2003 do serviço.',
 'Classifica o serviço para o ISS e a NFS-e; define a tributação municipal.',
 '1.07 (suporte em TI) · 17.01 (consultoria).',
 'Deixar sem LC 116: a maioria das prefeituras recusa a NFS-e sem o item da lista.',
 6,'/dashboard/cadastros/servicos','gestao_empresarial','publicado'),
('cadastros.servicos.col_iss','Serviços','% ISS',
 'Coluna (não se preenche aqui). A alíquota de ISS do serviço, em percentual. "—" quando 0/indefinida.',
 'É o imposto municipal que incide sobre o serviço na NFS-e.',
 '2,00% · 5,00%.',
 'Confiar em 0%/"—" sem conferir a alíquota do município para o item LC 116.',
 7,'/dashboard/cadastros/servicos','gestao_empresarial','publicado'),
('cadastros.servicos.col_valor','Serviços','Valor',
 'Coluna (não se preenche aqui). O valor unitário sugerido do serviço. "—" quando não informado.',
 'Pré-preenche o valor ao usar o serviço numa nota; pode ser ajustado na emissão.',
 'R$ 1.500,00.',
 'Tratar como preço fixo: é só sugestão; o valor final é definido na nota.',
 8,'/dashboard/cadastros/servicos','gestao_empresarial','publicado'),
('cadastros.servicos.col_acoes','Serviços','Ações',
 'Coluna (não se preenche aqui). Botões por linha: Clonar (criar a partir deste), Editar e Excluir.',
 'Dá acesso rápido às ações do serviço; a exclusão é lógica e rastreável (fica no histórico).',
 'Clonar uma consultoria para criar outra parecida.',
 'Excluir achando que apaga de vez: é exclusão lógica — o serviço vai para "Inativos" e pode voltar.',
 9,'/dashboard/cadastros/servicos','gestao_empresarial','publicado'),
('cadastros.servicos.excluir','Serviços','Excluir serviço',
 'Ação: tira o serviço do catálogo ativo. É exclusão LÓGICA (soft-delete), com registro de quem e quando.',
 'Remove o serviço da lista de ativos sem perder histórico; pode ser reativado em "Inativos".',
 'Excluir um serviço que a empresa parou de oferecer.',
 'Esperar apagar de vez: nada é apagado; para voltar, filtre "Inativos" e reative.',
 10,'/dashboard/cadastros/servicos','gestao_empresarial','publicado'),
('cadastros.servicos.reativar','Serviços','Reativar serviço',
 'Ação (na visão Inativos): devolve o serviço excluído para o catálogo ativo, com registro na auditoria.',
 'Desfaz uma exclusão lógica sem recadastrar; mantém o mesmo histórico.',
 'Reativar um serviço arquivado por engano.',
 'Recadastrar do zero quando bastava reativar: perde o histórico anterior.',
 11,'/dashboard/cadastros/servicos','gestao_empresarial','publicado')
ON CONFLICT (chave) DO NOTHING;
