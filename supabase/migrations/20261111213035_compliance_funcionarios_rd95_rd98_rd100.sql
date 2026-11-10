-- Compliance · Funcionários (/dashboard/compliance/funcionarios) · Auditoria visual aud8 09/11
-- Gaps: RD-100 (nome de terceiro "IO Point" visível), RD-98 p4 (sem Excluir/soft-delete),
--       RD-95 (0 "?" nos filtros/colunas/ações), RD-98 p3 (origem do dado nula).
-- Esta migration (ADITIVA, idempotente, NÃO altera dado de cliente — colunas novas NULL por padrão):
--   1) Soft-delete em compliance_funcionarios: colunas excluido_em / excluido_por.
--   2) fn_compliance_funcionario_arquivar / _restaurar: guardadas (auth + empregadora), com audit. Nunca DELETE físico.
--      OBS: 'ativo' (desligado) é conceito separado de 'excluido' (cadastro removido) — a exclusão NÃO mexe em 'ativo'.
--   3) Chaves de ajuda "?" (RD-95) dos filtros, colunas e ações.
--   4) system_screens: origem do dado (RD-98 p3).
-- Faixa de migration do code-desenvolvedor-3 (segundos :35), acima da main.

-- 1) Soft-delete (aditivo) ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.compliance_funcionarios
  ADD COLUMN IF NOT EXISTS excluido_em  timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- 2) Arquivar / Restaurar (soft-delete rastreável) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_compliance_funcionario_arquivar(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para excluir'); END IF;
  SELECT company_id, nome_completo INTO v_company, v_nome
    FROM public.compliance_funcionarios WHERE id = p_id AND excluido_em IS NULL FOR UPDATE;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Funcionário não encontrado ou já excluído'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE public.compliance_funcionarios
     SET excluido_em = now(), excluido_por = auth.uid(), updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_company, auth.uid(), 'compliance_funcionarios', p_id, 'arquivar',
            jsonb_build_object('excluido', false),
            jsonb_build_object('excluido', true, 'nome', v_nome, 'excluido_em', now()));
  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_compliance_funcionario_restaurar(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para restaurar'); END IF;
  SELECT company_id, nome_completo INTO v_company, v_nome
    FROM public.compliance_funcionarios WHERE id = p_id AND excluido_em IS NOT NULL FOR UPDATE;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Funcionário não encontrado ou não está excluído'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE public.compliance_funcionarios
     SET excluido_em = NULL, excluido_por = NULL, updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_company, auth.uid(), 'compliance_funcionarios', p_id, 'restaurar',
            jsonb_build_object('excluido', true),
            jsonb_build_object('excluido', false, 'nome', v_nome, 'restaurado_em', now()));
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_compliance_funcionario_arquivar(uuid)  FROM anon;
REVOKE ALL ON FUNCTION public.fn_compliance_funcionario_restaurar(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_compliance_funcionario_arquivar(uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_compliance_funcionario_restaurar(uuid) TO authenticated;

-- 3) RD-95 "?" (idempotente) ───────────────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/compliance/funcionarios', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('compliance.funcionarios.filtro.busca','Filtros','Buscar','Digite parte do nome, CPF ou matrícula do funcionário.','Encontra uma pessoa rápido, sem rolar a lista toda.','Digite "Maria" ou "123.456".','Digitar o CPF com pontos: a busca ignora a pontuação.',1),
 ('compliance.funcionarios.filtro.tomadora','Filtros','Tomadora','Escolha a empresa tomadora (onde a pessoa presta serviço) ou "Todas as tomadoras".','Separa, na terceirização, quem atende cada tomadora.','Selecione "Obra Centro" para ver só quem está nela.','Esquecer de voltar para "Todas" e achar que sumiram pessoas.',2),
 ('compliance.funcionarios.filtro.vinculo','Filtros','Vínculo','Escolha Diretos (CLT da empresa), Terceirizados (via prestador) ou Todos os vínculos.','Separa o quadro próprio dos terceirizados.','"Terceirizados" mostra só quem vem por prestador.','Confundir terceirizado com desligado: são filtros diferentes.',3),
 ('compliance.funcionarios.filtro.cargo','Filtros','Cargo','Escolha um cargo da lista ou "Todos os cargos".','Filtra a lista por função exercida.','Selecione "Eletricista" para ver só esses.','—',4),
 ('compliance.funcionarios.filtro.setor','Filtros','Setor','Escolha um setor da lista ou "Todos os setores".','Filtra a lista pelo setor de alocação da pessoa.','Selecione "Manutenção".','—',5),
 ('compliance.funcionarios.filtro.status','Filtros','Status do Compliance','Escolha 100% em dia, Pendências ou 0% em dia.','Mostra quem está com a documentação regular ou pendente.','"Pendências" lista quem tem algum documento vencido/faltando.','Confundir com status de cadastro: aqui é só a documentação.',6),
 ('compliance.funcionarios.filtro.cadastro','Filtros','Cadastro','Escolha Ativos (em uso) ou Excluídos (arquivados).','Separa os cadastros em uso dos que foram excluídos — a exclusão é reversível.','"🗑 Excluídos" mostra os arquivados, com a opção Restaurar.','Procurar um cadastro excluído na lista de Ativos: ele só aparece em Excluídos.',7),
 ('compliance.funcionarios.col.nome','Colunas','Nome','Nada a preencher: nome completo do funcionário. Clique para abrir a ficha.','Identifica a pessoa na lista.','"Maria de Souza".','—',8),
 ('compliance.funcionarios.col.cpf','Colunas','CPF','Nada a preencher: CPF do funcionário.','Confere a identidade da pessoa.','123.456.789-00.','"—" significa CPF não cadastrado, não erro.',9),
 ('compliance.funcionarios.col.vinculo','Colunas','Vínculo','Nada a preencher: mostra se a pessoa é Direta (CLT) ou Terceirizada (com o prestador).','Deixa claro o tipo de contratação de cada pessoa.','"Terceirizado · Prestadora Silva".','—',10),
 ('compliance.funcionarios.col.cargo_setor','Colunas','Cargo / Setor','Nada a preencher: cargo (função) e setor de alocação da pessoa.','Mostra o que a pessoa faz e onde atua.','"Eletricista / Manutenção".','—',11),
 ('compliance.funcionarios.col.empresa','Colunas','Empresa','Nada a preencher: empresa empregadora do funcionário (no grupo).','Em grupo de empresas, mostra de qual empresa é a pessoa.','"Construtora Alfa".','—',12),
 ('compliance.funcionarios.col.tomadora','Colunas','Tomadora','Nada a preencher: empresa tomadora e obra onde a pessoa presta serviço.','Mostra onde a pessoa está alocada na terceirização.','"Obra Centro · Edifício Sol".','—',13),
 ('compliance.funcionarios.col.compliance','Colunas','Compliance','Nada a preencher: % de documentos obrigatórios em dia (barra e "em dia / total").','Resume a regularidade documental da pessoa.','"80% · 8/10 em dia".','0% pode ser documentação não lançada, confira na ficha.',14),
 ('compliance.funcionarios.col.acoes','Colunas','Ações','Nada a preencher: botões para Abrir a ficha, Excluir (ou Restaurar, na aba Excluídos).','Permite agir sobre a pessoa direto da lista.','Clique em Abrir para ver a documentação.','Excluir sem querer: há confirmação e o excluído pode ser restaurado.',15),
 ('compliance.funcionarios.acao.importar','Ações','Importar do ponto eletrônico','Clique para trazer os colaboradores do sistema de ponto (relógio-ponto) para a ficha do Compliance.','Cadastra de uma vez quem já está no controle de ponto, sem redigitar.','Importa os colaboradores com CPF; preserva o que você já preencheu à mão.','Importar sem conferir CPF: quem está sem CPF no ponto é ignorado.',16),
 ('compliance.funcionarios.acao.novo','Ações','+ Novo funcionário','Clique para cadastrar uma pessoa manualmente.','Abre o formulário de cadastro de funcionário.','+ Novo funcionário para incluir "Maria de Souza".','—',17),
 ('compliance.funcionarios.acao.abrir','Ações','Abrir','Clique para abrir a ficha da pessoa (dados, documentos e histórico).','Leva à documentação completa do funcionário.','Abrir para lançar/renovar o ASO.','—',18),
 ('compliance.funcionarios.acao.excluir','Ações','Excluir','Clique para excluir (arquivar) o cadastro da pessoa. Pede confirmação.','Tira o funcionário da lista ativa sem apagar o histórico — é reversível.','Excluir um cadastro duplicado.','Achar que some para sempre: fica em "🗑 Excluídos" e pode ser restaurado.',19),
 ('compliance.funcionarios.acao.restaurar','Ações','Restaurar','Clique, na aba Excluídos, para trazer o cadastro de volta à lista ativa.','Desfaz uma exclusão feita por engano.','Restaurar um funcionário arquivado sem querer.','—',20)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- 4) RD-98 p3 · origem do dado ─────────────────────────────────────────────────────────────────
UPDATE public.system_screens
   SET views_consumidas = ARRAY['compliance_funcionarios','v_compliance_matriz_funcionarios']::text[],
       rpcs_chamadas   = ARRAY['fn_compliance_funcionario_arquivar','fn_compliance_funcionario_restaurar','fn_compliance_projetar_de_ind_ponto','fn_ajuda_campo_listar']::text[]
 WHERE rota = '/dashboard/compliance/funcionarios';
