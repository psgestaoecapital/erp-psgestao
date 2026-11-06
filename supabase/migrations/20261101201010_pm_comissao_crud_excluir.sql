-- P&M · Comissão (auditoria 31/10, nota 88 → >=95): CRUD completo + exclusão rastreável.
-- Hoje a tela só muda status (Aprovar/Marcar paga). Faltava INCLUIR e EDITAR lançamento de comissão
-- e EXCLUIR de forma rastreável (RD-98 pilares 2 e 4). Tudo ADITIVO:
--   * agency_comissao ganha deleted_em/deleted_por (soft-delete; nunca DELETE físico);
--   * 3 RPCs novas SECURITY DEFINER com a MESMA guarda das existentes
--     (company_id IN get_user_company_ids() OR is_admin()) e rastro em audit_log_global;
--   * só comissão PREVISTA pode ser editada/excluída (a_pagar/paga já tocaram o financeiro — erp_pagar);
--   * chaves de ajuda (RD-95) dos campos/ações novos.
-- Escopo por company_id (RD-45). REVOKE anon.

-- 1) Soft-delete rastreável (aditivo, idempotente)
ALTER TABLE public.agency_comissao ADD COLUMN IF NOT EXISTS deleted_em timestamptz;
ALTER TABLE public.agency_comissao ADD COLUMN IF NOT EXISTS deleted_por uuid;

-- 2) INCLUIR lançamento de comissão (status inicial 'prevista')
CREATE OR REPLACE FUNCTION public.fn_agency_comissao_criar(
  p_company_id uuid, p_vendedor_id uuid, p_base_valor numeric, p_percentual numeric,
  p_competencia date, p_job_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_valor numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF COALESCE(p_base_valor,0) < 0 OR COALESCE(p_percentual,0) < 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'base e percentual não podem ser negativos'); END IF;
  -- job informado tem de ser da mesma empresa
  IF p_job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM agency_jobs WHERE id = p_job_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'job de outra empresa'); END IF;

  v_valor := round(COALESCE(p_base_valor,0) * COALESCE(p_percentual,0) / 100.0, 2);

  INSERT INTO agency_comissao (company_id, job_id, vendedor_id, base_valor, percentual, valor_comissao, competencia, status)
  VALUES (p_company_id, p_job_id, p_vendedor_id, p_base_valor, p_percentual, v_valor, p_competencia, 'prevista')
  RETURNING id INTO v_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'agency_comissao', v_id, 'comissao_criar',
          NULL,
          jsonb_build_object('vendedor_id', p_vendedor_id, 'job_id', p_job_id, 'base_valor', p_base_valor,
                             'percentual', p_percentual, 'valor_comissao', v_valor, 'competencia', p_competencia));

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'valor_comissao', v_valor);
END $function$;

-- 3) EDITAR lançamento (só enquanto 'prevista')
CREATE OR REPLACE FUNCTION public.fn_agency_comissao_editar(
  p_id uuid, p_vendedor_id uuid, p_base_valor numeric, p_percentual numeric,
  p_competencia date, p_job_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_c agency_comissao%ROWTYPE; v_valor numeric;
BEGIN
  SELECT * INTO v_c FROM agency_comissao WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'comissão não encontrada'); END IF;
  IF NOT (v_c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF v_c.deleted_em IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'comissão excluída'); END IF;
  IF v_c.status <> 'prevista' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'só comissão prevista pode ser editada (a pagar/paga já estão no financeiro)'); END IF;
  IF COALESCE(p_base_valor,0) < 0 OR COALESCE(p_percentual,0) < 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'base e percentual não podem ser negativos'); END IF;
  IF p_job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM agency_jobs WHERE id = p_job_id AND company_id = v_c.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'job de outra empresa'); END IF;

  v_valor := round(COALESCE(p_base_valor,0) * COALESCE(p_percentual,0) / 100.0, 2);

  UPDATE agency_comissao
     SET job_id = p_job_id, vendedor_id = p_vendedor_id, base_valor = p_base_valor,
         percentual = p_percentual, valor_comissao = v_valor, competencia = p_competencia
   WHERE id = p_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_c.company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'agency_comissao', p_id, 'comissao_editar',
          jsonb_build_object('vendedor_id', v_c.vendedor_id, 'job_id', v_c.job_id, 'base_valor', v_c.base_valor,
                             'percentual', v_c.percentual, 'valor_comissao', v_c.valor_comissao, 'competencia', v_c.competencia),
          jsonb_build_object('vendedor_id', p_vendedor_id, 'job_id', p_job_id, 'base_valor', p_base_valor,
                             'percentual', p_percentual, 'valor_comissao', v_valor, 'competencia', p_competencia));

  RETURN jsonb_build_object('ok', true, 'valor_comissao', v_valor);
END $function$;

-- 4) EXCLUIR rastreável (soft-delete; só enquanto 'prevista' — não mexe no financeiro já lançado)
CREATE OR REPLACE FUNCTION public.fn_agency_comissao_excluir(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_c agency_comissao%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM agency_comissao WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'comissão não encontrada'); END IF;
  IF NOT (v_c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF v_c.deleted_em IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'ja_excluida', true); END IF;
  IF v_c.status <> 'prevista' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'só comissão prevista pode ser excluída; a pagar/paga exige estorno no financeiro'); END IF;

  UPDATE agency_comissao
     SET deleted_em = now(), deleted_por = v_uid, status = 'cancelada'
   WHERE id = p_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_c.company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'agency_comissao', p_id, 'comissao_excluir',
          jsonb_build_object('status', v_c.status, 'valor_comissao', v_c.valor_comissao),
          jsonb_build_object('status', 'cancelada', 'deleted_em', now(), 'deleted_por', v_uid, 'motivo', p_motivo));

  RETURN jsonb_build_object('ok', true);
END $function$;

-- 5) Trancar as RPCs (sem anon; só usuário logado / serviço)
REVOKE ALL ON FUNCTION public.fn_agency_comissao_criar(uuid, uuid, numeric, numeric, date, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_agency_comissao_editar(uuid, uuid, numeric, numeric, date, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_agency_comissao_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_comissao_criar(uuid, uuid, numeric, numeric, date, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_agency_comissao_editar(uuid, uuid, numeric, numeric, date, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_agency_comissao_excluir(uuid, text) TO authenticated, service_role;

-- 6) Ajuda (RD-95) dos campos/ações novos
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('pm.comissao.acao_novo', '/dashboard/pm/comissao', 'Comissão · Ações', 'Novo lançamento',
  'Abre o formulário para lançar uma comissão manualmente: vendedor, job (opcional), base, percentual e competência.',
  'Registrar comissões que não vieram de uma proposta aprovada (acordo pontual, bônus comercial, ajuste).',
  'Bônus de fechamento de um vendedor em março → Novo lançamento → base R$ 10.000, 5%, competência 03/2026.',
  'Lançar comissão já paga por fora: a comissão nasce como "prevista" e precisa ser aprovada para ir ao financeiro.',
  'pm', 10, 1, 'publicado'),
 ('pm.comissao.acao_editar', '/dashboard/pm/comissao', 'Comissão · Ações', 'Editar',
  'Edita os dados de uma comissão ainda "prevista" (vendedor, job, base, percentual, competência). O valor é recalculado.',
  'Corrigir um lançamento antes de ele virar conta a pagar.',
  'Percentual lançado errado (10% em vez de 5%) → Editar → corrige e o valor da comissão se ajusta.',
  'Tentar editar comissão "a pagar" ou "paga": não é permitido — ela já tocou o financeiro; estorne no contas a pagar primeiro.',
  'pm', 11, 1, 'publicado'),
 ('pm.comissao.acao_excluir', '/dashboard/pm/comissao', 'Comissão · Ações', 'Excluir',
  'Exclui (cancela) uma comissão ainda "prevista". É exclusão rastreável: guarda quem excluiu, quando e o motivo; o registro não some do banco.',
  'Remover um lançamento indevido sem apagar o histórico.',
  'Comissão duplicada → Excluir → informe o motivo; ela sai da lista mas fica auditável.',
  'Querer excluir comissão "a pagar"/"paga": não é permitido pela tela — o acerto é no financeiro.',
  'pm', 12, 1, 'publicado'),
 ('pm.comissao.campo_vendedor', '/dashboard/pm/comissao', 'Comissão · Novo lançamento', 'Vendedor',
  'Quem recebe a comissão. Escolha entre os usuários da empresa.',
  'Identificar o beneficiário da comissão no fechamento e no contas a pagar.',
  'Ana Souza (comercial).',
  'Deixar sem vendedor: a comissão fica sem dono e dificulta a conferência.',
  'pm', 13, 1, 'publicado'),
 ('pm.comissao.campo_job', '/dashboard/pm/comissao', 'Comissão · Novo lançamento', 'Job (opcional)',
  'Job ao qual a comissão se refere, quando houver. Pode ficar vazio para comissões avulsas.',
  'Ligar a comissão ao trabalho que a originou, para análise por job.',
  'Campanha Verão 2026.',
  'Escolher um job de outra empresa: o sistema recusa (escopo por empresa).',
  'pm', 14, 1, 'publicado'),
 ('pm.comissao.campo_base', '/dashboard/pm/comissao', 'Comissão · Novo lançamento', 'Base (R$)',
  'Valor sobre o qual a comissão é calculada (ex.: valor do job ou da venda).',
  'É a base do cálculo: comissão = base × percentual.',
  'R$ 10.000,00.',
  'Informar valor negativo: não é aceito.',
  'pm', 15, 1, 'publicado'),
 ('pm.comissao.campo_percentual', '/dashboard/pm/comissao', 'Comissão · Novo lançamento', 'Percentual (%)',
  'Percentual aplicado sobre a base para apurar a comissão.',
  'Define quanto da base vira comissão.',
  '5 (para 5%).',
  'Digitar 0,05 achando que é 5%: o campo é em por cento (use 5).',
  'pm', 16, 1, 'publicado'),
 ('pm.comissao.campo_competencia', '/dashboard/pm/comissao', 'Comissão · Novo lançamento', 'Competência',
  'Mês/ano a que a comissão pertence.',
  'Organiza o fechamento por competência e define o vencimento no contas a pagar.',
  'Março/2026.',
  'Deixar vazio: a comissão não entra no fechamento do mês correto.',
  'pm', 17, 1, 'publicado'),
 ('pm.comissao.campo_motivo_exclusao', '/dashboard/pm/comissao', 'Comissão · Ações', 'Motivo da exclusão',
  'Explique por que está excluindo a comissão. Fica registrado na auditoria.',
  'Deixar rastro de quem excluiu e por quê (exclusão rastreável, RD-98).',
  'Lançamento duplicado da proposta 123.',
  'Excluir sem motivo: dificulta a conferência depois.',
  'pm', 18, 1, 'publicado'),
 ('pm.comissao.col_vendedor', '/dashboard/pm/comissao', 'Comissão · Colunas', 'Vendedor',
  'Quem recebe a comissão de cada lançamento.',
  'Identificar o beneficiário em cada linha da lista.',
  'Ana Souza.',
  'Confundir vendedor com quem aprovou: aqui é quem recebe.',
  'pm', 19, 1, 'publicado'),
 ('pm.comissao.col_acoes', '/dashboard/pm/comissao', 'Comissão · Colunas', 'Ações',
  'Botões da linha: aprovar, marcar paga, editar ou excluir — conforme o status da comissão.',
  'Agir sobre a comissão sem sair da lista.',
  'Comissão prevista → Editar/Excluir/Aprovar disponíveis.',
  'Procurar Editar/Excluir numa comissão já a pagar/paga: só aparecem na prevista.',
  'pm', 20, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;

-- 7) Origem do dado (RD-98 pilar 3): registrar as RPCs novas no catálogo de telas
UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY['fn_agency_comissao_aprovar','fn_agency_comissao_marcar_paga',
                             'fn_agency_comissao_criar','fn_agency_comissao_editar','fn_agency_comissao_excluir',
                             'fn_usuarios_da_empresa']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/pm/comissao';
