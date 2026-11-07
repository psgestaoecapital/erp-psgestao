-- Chamado #6713 (financeiro · todas as empresas · APROVADO CEO 05/11) — Code: code-desenvolvedor-3
-- Caso real da Jordana: "lancei conta de R$200 e registrei o pagamento, mas o certo é R$250 —
-- quero CANCELAR o recebimento, alterar o valor e informar de novo."
--
-- GAP (RD-26, auditado no banco): havia baixar/registrar recebimento e pagamento, excluir (com
-- cancelar-baixa embutido) e cancelar título, mas NÃO havia como DESFAZER só a baixa mantendo o
-- título. A única forma de reverter uma baixa era EXCLUIR o título. Estas duas funções NOVAS
-- (aditivas) desfazem a baixa e devolvem o título para EM ABERTO — sem excluir, rastreável.
--
-- Reusa o padrão PROVADO do fn_receber_excluir/fn_pagar_excluir (ramo CANCELOU_BAIXA):
--   * guarda de empresa (get_user_company_ids) · SECURITY DEFINER · REVOKE anon;
--   * bloqueio se o lançamento está CONCILIADO com o banco (avisa p/ cancelar no inbox antes);
--   * trilha de auditoria em erp_lancamento_log (quem/quando/motivo/valor estornado);
--   * UPDATE idêntico ao do excluir: status='aberto', valor_pago=0, data_pagamento=NULL, conciliado=false.
-- A MAIS que o excluir: também faz soft-delete das baixas do razão (erp_receber_baixa/erp_pagar_baixa)
-- não-conciliadas, porque o título CONTINUA visível (o excluir não precisa — some o título). O trigger
-- *_baixa_recompute zera o valor_pago do caminho de razão; o UPDATE direto cobre o caminho "Marcar
-- recebido/pago" (que grava valor_pago sem linha no razão). Idempotente: re-rodar num título já em
-- aberto devolve 'nada_a_estornar' (não há baixa dupla).
--
-- Prova RD-38 (BEGIN…ROLLBACK, DEMO b0700000-0000-4000-a000-000000000002, timeout curto):
--   ANTES : status=pago   valor_pago=400,00 baixas_ativas=2
--   DEPOIS: status=aberto  valor_pago=0,00   baixas_ativas=0  (data_pagamento=NULL)
-- Nunca apaga/altera dado de cliente nem título conciliado (bloqueado). SENSÍVEL (financeiro):
-- revisao-eng-chefe + MERGE AUTORIZADO.

-- ===================== CONTAS A RECEBER: estornar recebimento =====================
CREATE OR REPLACE FUNCTION public.fn_receber_estornar_baixa(p_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_registro jsonb; v_status text; v_company_id uuid; v_del timestamptz;
        v_valor_pago numeric; v_tem_concil boolean; v_email text := public.fn_user_email_atual();
BEGIN
  SELECT to_jsonb(r.*), r.status, r.company_id, r.deleted_at, COALESCE(r.valor_pago,0)
    INTO v_registro, v_status, v_company_id, v_del, v_valor_pago
  FROM public.erp_receber r WHERE r.id = p_id;

  IF v_registro IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado'); END IF;
  IF v_del IS NOT NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'excluido', 'orientacao', 'Este lançamento foi excluído — não há recebimento para estornar.');
  END IF;
  IF NOT (v_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;

  IF v_status NOT IN ('pago','parcial') AND v_valor_pago <= 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'nada_a_estornar',
      'orientacao', 'Este título não tem recebimento lançado para estornar.');
  END IF;

  v_tem_concil := EXISTS (SELECT 1 FROM public.conciliacao_vinculo v WHERE v.lancamento_tabela='erp_receber' AND v.lancamento_id=p_id)
               OR EXISTS (SELECT 1 FROM public.conciliacao_movimento m WHERE m.lancamento_tabela='erp_receber' AND m.lancamento_id=p_id);
  IF v_tem_concil THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'bloqueado_conciliado',
      'orientacao', 'Este recebimento está conciliado com o banco. Cancele a conciliação no inbox antes de estornar.');
  END IF;

  -- auditoria (quem/quando/motivo) — mesma trilha do financeiro
  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
  VALUES (p_id, v_email, 'ESTORNOU_BAIXA',
          jsonb_build_object('motivo', p_motivo, 'valor_estornado', v_valor_pago, 'registro', v_registro), 'erp_receber');

  -- desfaz as baixas do razão (não-conciliadas); o trigger recompute zera o valor_pago do caminho de razão
  UPDATE public.erp_receber_baixa SET deleted_at = now(), deleted_by = auth.uid()
   WHERE receber_id = p_id AND deleted_at IS NULL AND movimento_banco_id IS NULL;

  -- cobre o caminho direto ("Marcar recebido", sem linha no razão) e garante consistência: volta ao aberto
  UPDATE public.erp_receber
     SET status='aberto', valor_pago=0, data_pagamento=NULL, conciliado=false, updated_at=now()
   WHERE id = p_id;

  RETURN jsonb_build_object('sucesso', true, 'id', p_id, 'valor_estornado', v_valor_pago, 'status', 'aberto');
END $function$;

-- ===================== CONTAS A PAGAR: cancelar pagamento =====================
CREATE OR REPLACE FUNCTION public.fn_pagar_cancelar_pagamento(p_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_registro jsonb; v_status text; v_company_id uuid; v_del timestamptz;
        v_valor_pago numeric; v_tem_concil boolean; v_email text := public.fn_user_email_atual();
BEGIN
  SELECT to_jsonb(p.*), p.status, p.company_id, p.deleted_at, COALESCE(p.valor_pago,0)
    INTO v_registro, v_status, v_company_id, v_del, v_valor_pago
  FROM public.erp_pagar p WHERE p.id = p_id;

  IF v_registro IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado'); END IF;
  IF v_del IS NOT NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'excluido', 'orientacao', 'Este lançamento foi excluído — não há pagamento para cancelar.');
  END IF;
  IF NOT (v_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;

  IF v_status NOT IN ('pago','parcial') AND v_valor_pago <= 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'nada_a_estornar',
      'orientacao', 'Este título não tem pagamento lançado para cancelar.');
  END IF;

  v_tem_concil := EXISTS (SELECT 1 FROM public.conciliacao_vinculo v WHERE v.lancamento_tabela='erp_pagar' AND v.lancamento_id=p_id)
               OR EXISTS (SELECT 1 FROM public.conciliacao_movimento m WHERE m.lancamento_tabela='erp_pagar' AND m.lancamento_id=p_id);
  IF v_tem_concil THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'bloqueado_conciliado',
      'orientacao', 'Este pagamento está conciliado com o banco. Cancele a conciliação no inbox antes de cancelar o pagamento.');
  END IF;

  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
  VALUES (p_id, v_email, 'CANCELOU_PAGAMENTO',
          jsonb_build_object('motivo', p_motivo, 'valor_estornado', v_valor_pago, 'registro', v_registro), 'erp_pagar');

  UPDATE public.erp_pagar_baixa SET deleted_at = now(), deleted_by = auth.uid()
   WHERE pagar_id = p_id AND deleted_at IS NULL AND movimento_banco_id IS NULL;

  UPDATE public.erp_pagar
     SET status='aberto', valor_pago=0, data_pagamento=NULL, conciliado=false, updated_at=now()
   WHERE id = p_id;

  RETURN jsonb_build_object('sucesso', true, 'id', p_id, 'valor_estornado', v_valor_pago, 'status', 'aberto');
END $function$;

-- Guarda de acesso: só usuário autenticado (a função valida a empresa); nunca anon.
REVOKE ALL ON FUNCTION public.fn_receber_estornar_baixa(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_pagar_cancelar_pagamento(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_receber_estornar_baixa(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_pagar_cancelar_pagamento(uuid, text) TO authenticated, service_role;

-- ===================== RD-95 ("?") da ação nova (estornar/cancelar pagamento) =====================
-- Ajuda de campo da ação nova nas listas de Contas a Receber e Contas a Pagar (chave nova no banco,
-- lida por fn_ajuda_campo_listar na própria tela). Explica o que o estorno faz, quando bloqueia
-- (título conciliado) e o próximo passo (editar o valor e marcar recebido/pago de novo). Idempotente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
  ('financeiro.receber.estornar_baixa', 'Receitas a Receber', 'Estornar recebimento',
   'Clique quando o recebimento foi lançado com algum dado errado (valor, data) e você precisa refazer. O botão só aparece em título já baixado (✓ baixado). O sistema desfaz a baixa e devolve o título para EM ABERTO — sem excluir o lançamento.',
   'Desfaz a baixa do recebimento: zera o valor recebido e a data de pagamento e volta o status para EM ABERTO, mantendo o título. Depois é só Editar o valor certo e marcar recebido de novo. A ação fica registrada (quem/quando/motivo) na trilha do lançamento.',
   'Recebeu R$200 mas o certo era R$250: clique em Estornar, Edite o valor para R$250 e marque recebido novamente.',
   'Tentar estornar um recebimento já conciliado com o extrato do banco: o sistema bloqueia e pede para cancelar a conciliação no inbox antes.',
   2, '/dashboard/financeiro/receber', 'gestao_empresarial', 'publicado'),
  ('financeiro.pagar.cancelar_pagamento', 'Despesas a Pagar', 'Cancelar pagamento',
   'Clique quando o pagamento foi lançado com algum dado errado (valor, data) e você precisa refazer. O botão só aparece em título já baixado (✓ baixado). O sistema desfaz a baixa e devolve o título para EM ABERTO — sem excluir o lançamento.',
   'Desfaz a baixa do pagamento: zera o valor pago e a data de pagamento e volta o status para EM ABERTO, mantendo o título. Depois é só Editar o valor certo e marcar pago de novo. A ação fica registrada (quem/quando/motivo) na trilha do lançamento.',
   'Pagou R$200 mas o certo era R$250: clique em Cancelar pagto, Edite o valor para R$250 e marque pago novamente.',
   'Tentar cancelar um pagamento já conciliado com o extrato do banco: o sistema bloqueia e pede para cancelar a conciliação no inbox antes.',
   2, '/dashboard/financeiro/pagar', 'gestao_empresarial', 'publicado')
ON CONFLICT (chave) DO NOTHING;
