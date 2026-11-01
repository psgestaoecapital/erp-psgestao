-- GE › Financeiro › Financiamento (pedido do cliente Tryo Gesso via CEO, 28/10/2026 18:41):
-- "editar, excluir, arquivar os empréstimos que já venceram". Regra do sistema: tudo editável, excluível (com rastro),
-- arquivável e restaurável.
--
-- 1) Colunas de rastro em financiamentos: arquivado_em/por/motivo, excluido_em/por/motivo, quitado_em, status_anterior.
-- 2) fn_financiamento_situacao(p_id, p_acao, p_motivo, p_data): arquivar · desarquivar · quitar · reabrir · excluir · restaurar.
--    - arquivar → status 'encerrado' (some dos indicadores, que já ignoram encerrado/quitado/cancelado), guarda o status anterior.
--    - quitar → status 'quitado' + data.
--    - excluir → EXCLUSÃO RASTREÁVEL: status 'cancelado' + quem/quando/motivo (motivo obrigatório); o contrato e o cronograma
--      ficam no banco e podem ser restaurados. Antes a tela apagava de vez (DELETE em cascata nas parcelas).
--    - desarquivar/reabrir/restaurar → volta ao status anterior.
--    Devolve quantas contas a pagar EM ABERTO geradas pelo contrato continuam no financeiro (a tela avisa; nada é apagado).
-- 3) Guarda: empresa do usuário (get_user_company_ids/is_admin); autoria por auth.uid().
--
-- Aditiva: colunas anuláveis + 1 função nova + índice. Não altera nenhuma função existente nem dado de cliente.

ALTER TABLE public.financiamentos
  ADD COLUMN IF NOT EXISTS arquivado_em timestamptz,
  ADD COLUMN IF NOT EXISTS arquivado_por uuid,
  ADD COLUMN IF NOT EXISTS arquivado_motivo text,
  ADD COLUMN IF NOT EXISTS excluido_em timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por uuid,
  ADD COLUMN IF NOT EXISTS excluido_motivo text,
  ADD COLUMN IF NOT EXISTS quitado_em date,
  ADD COLUMN IF NOT EXISTS status_anterior text;

CREATE INDEX IF NOT EXISTS ix_financiamentos_company_status ON public.financiamentos (company_id, status);

CREATE OR REPLACE FUNCTION public.fn_financiamento_situacao(p_id uuid, p_acao text, p_motivo text DEFAULT NULL, p_data date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  f financiamentos%ROWTYPE; v_uid uuid := auth.uid(); v_motivo text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_abertas int; v_novo text;
BEGIN
  SELECT * INTO f FROM financiamentos WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'contrato_nao_encontrado'); END IF;
  IF NOT (f.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  IF p_acao NOT IN ('arquivar','desarquivar','quitar','reabrir','excluir','restaurar') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'acao_invalida');
  END IF;

  IF p_acao = 'arquivar' THEN
    IF f.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'contrato_excluido'); END IF;
    UPDATE financiamentos SET status_anterior = COALESCE(NULLIF(status, 'encerrado'), status_anterior, 'ativo'), status = 'encerrado',
           arquivado_em = now(), arquivado_por = v_uid, arquivado_motivo = v_motivo WHERE id = p_id;
  ELSIF p_acao = 'quitar' THEN
    IF f.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'contrato_excluido'); END IF;
    UPDATE financiamentos SET status_anterior = COALESCE(NULLIF(status, 'quitado'), status_anterior, 'ativo'), status = 'quitado',
           quitado_em = COALESCE(p_data, current_date) WHERE id = p_id;
  ELSIF p_acao = 'excluir' THEN
    IF v_motivo IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio'); END IF;
    UPDATE financiamentos SET status_anterior = COALESCE(NULLIF(status, 'cancelado'), status_anterior, 'ativo'), status = 'cancelado',
           excluido_em = now(), excluido_por = v_uid, excluido_motivo = v_motivo WHERE id = p_id;
  ELSE -- desarquivar · reabrir · restaurar: volta ao status anterior
    v_novo := COALESCE(NULLIF(f.status_anterior, ''), 'ativo');
    IF v_novo IN ('encerrado','quitado','cancelado') THEN v_novo := 'ativo'; END IF;
    UPDATE financiamentos SET status = v_novo, status_anterior = NULL,
           arquivado_em = CASE WHEN p_acao IN ('desarquivar','restaurar') THEN NULL ELSE arquivado_em END,
           arquivado_por = CASE WHEN p_acao IN ('desarquivar','restaurar') THEN NULL ELSE arquivado_por END,
           arquivado_motivo = CASE WHEN p_acao IN ('desarquivar','restaurar') THEN NULL ELSE arquivado_motivo END,
           quitado_em = CASE WHEN p_acao IN ('reabrir','restaurar') THEN NULL ELSE quitado_em END,
           excluido_em = CASE WHEN p_acao = 'restaurar' THEN NULL ELSE excluido_em END,
           excluido_por = CASE WHEN p_acao = 'restaurar' THEN NULL ELSE excluido_por END,
           excluido_motivo = CASE WHEN p_acao = 'restaurar' THEN NULL ELSE excluido_motivo END
     WHERE id = p_id;
  END IF;

  SELECT count(*) INTO v_abertas FROM erp_pagar
   WHERE company_id = f.company_id AND ref_externa_sistema = 'financiamento'
     AND ref_externa_id LIKE 'fin:' || p_id::text || ':%' AND lower(COALESCE(status, '')) NOT IN ('pago','paga','cancelado','cancelada');

  RETURN jsonb_build_object('ok', true, 'acao', p_acao,
    'status', (SELECT status FROM financiamentos WHERE id = p_id), 'contas_pagar_abertas', v_abertas);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_financiamento_situacao(uuid, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_financiamento_situacao(uuid, text, text, date) TO authenticated;

-- "?" (RD-95) das ações e filtros novos da tela
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('ge.financiamento.filtro', '/dashboard/gestao-empresarial/financiamento', 'Financiamento', 'Filtro de situação',
   'Escolha quais contratos ver: Em dia, Vencidos, Quitados, Arquivados, Excluídos ou Todos.',
   'Separa os empréstimos que ainda correm dos que já venceram, foram quitados ou guardados, sem perder o histórico.',
   'Clique em "Vencidos" para ver os contratos cuja última parcela já passou.',
   'Achar que um contrato sumiu: ele pode estar em Arquivados ou Excluídos.', 'gestao_empresarial', 900),
  ('ge.financiamento.vencido', '/dashboard/gestao-empresarial/financiamento', 'Financiamento', 'Vencido',
   'Nada a preencher: o contrato aparece como vencido quando a data de vencimento final já passou.',
   'Mostra os empréstimos que já terminaram e precisam ser quitados ou arquivados.',
   'Vencimento final 15/07/2026 e hoje 28/10/2026 → vencido.',
   'Deixar contrato vencido como ativo: ele continua somando no compromisso mensal.', 'gestao_empresarial', 901),
  ('ge.financiamento.arquivar', '/dashboard/gestao-empresarial/financiamento', 'Financiamento', 'Arquivar',
   'Clique para guardar o contrato. Pode informar um motivo. Dá para desarquivar a qualquer momento.',
   'Tira o contrato encerrado dos indicadores e da lista principal, mantendo o histórico e o cronograma.',
   'Empréstimo Sicoob que terminou em julho → Arquivar.',
   'Excluir um contrato que só terminou: o certo é quitar ou arquivar.', 'gestao_empresarial', 902),
  ('ge.financiamento.quitar', '/dashboard/gestao-empresarial/financiamento', 'Financiamento', 'Marcar como quitado',
   'Informe a data em que o contrato foi quitado.',
   'Registra que a dívida acabou: sai do saldo devedor e do compromisso mensal.',
   'Quitação antecipada em 10/10/2026.',
   'Esquecer as contas a pagar em aberto do contrato: a tela avisa quantas ainda existem no financeiro.', 'gestao_empresarial', 903),
  ('ge.financiamento.excluir', '/dashboard/gestao-empresarial/financiamento', 'Financiamento', 'Excluir',
   'Informe o motivo (obrigatório). O contrato vai para "Excluídos" e pode ser restaurado.',
   'Remove contrato lançado por engano sem apagar o histórico: fica registrado quem excluiu, quando e por quê.',
   'Contrato cadastrado em duplicidade → Excluir com o motivo "duplicado".',
   'Usar Excluir para empréstimo que terminou: use Quitar ou Arquivar.', 'gestao_empresarial', 904),
  ('ge.financiamento.acoes', '/dashboard/gestao-empresarial/financiamento', 'Financiamento', 'Ações do contrato',
   'Escolha o que fazer com o contrato: editar, recalcular, gerar cronograma, gerar contas a pagar, quitar, arquivar ou excluir.',
   'Concentra todas as operações do contrato num só lugar.',
   'Editar a taxa → Salvar → Recalcular.',
   'Gerar contas a pagar antes do cronograma: não há parcelas para lançar.', 'gestao_empresarial', 905),
  ('ge.financiamento.kpis', '/dashboard/gestao-empresarial/financiamento', 'Financiamento', 'Indicadores',
   'Nada a preencher: somam só os contratos em andamento (não contam quitados, arquivados nem excluídos).',
   'Mostra quanto a empresa deve hoje, quanto paga por mês e quanto de juros ainda vai pagar.',
   'Saldo de quitação R$ 900 mil · compromisso mensal R$ 45 mil.',
   'Contrato vencido ainda ativo infla o compromisso mensal: quite ou arquive.', 'gestao_empresarial', 906)
ON CONFLICT (chave) DO NOTHING;
