-- #P2 Caixa do grupo v2 — card "Para tratar hoje" (CEO 12/11, tarefa 162e7c6a) · SLICE 3
-- Estende fn_ge_pendencias_dia (slice 1, #4785) com a pendência de QUALIDADE DO DADO:
--   (10) lançamentos SEM categoria (afetam o DRE) — a pagar e a receber, por empresa.
--
-- Aditiva: só ACRESCENTA dois tipos de pendência ao fim do laço por empresa; nenhuma
-- pendência existente muda. O card (ParaTratarHoje.tsx) já renderiza qualquer pendência
-- retornada, então esta PR é só backend (sem mudança de tela).
--
-- Segurança INALTERADA: SECURITY DEFINER, SET search_path=public, fail-closed por
-- get_user_company_ids; cada leitura nova é filtrada por company_id = v_cid (empresa já
-- validada no laço, ∈ get_user_company_ids). Read-only. REVOKE anon reafirmado.
--
-- RD-38 provado (Pdois/Prigol 36b69d77-b4ea-414b-8519-2ff6621c8de7, 12/11):
--   a pagar sem categoria  = 61 lançamentos / R$ 196.039,84
--   a receber sem categoria = 148 lançamentos / R$ 97.743,26
--   (status <> 'cancelado'; categoria NULL ou vazia)
--
-- Pendências (7) conciliação movimento-sem-lançamento, (8) contratos sem anexo e
-- (9) contratos a faturar ficam para o próximo slice (fontes ainda a mapear com segurança).
-- Faixa jordana-code (segundos :20).

-- Limpeza de artefato de validação de sintaxe (throwaway usado na prova do slice 3;
-- fail-closed, nunca chamado pela aplicação). Idempotente.
DROP FUNCTION IF EXISTS public.fn__tmp_validate_slice3_xyz(uuid[], date);

CREATE OR REPLACE FUNCTION public.fn_ge_pendencias_dia(
  p_company_ids uuid[] DEFAULT NULL,
  p_data date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed uuid[];
  v_cids    uuid[];
  v_cid     uuid;
  v_nome    text;
  v_caixa   jsonb;
  v_pend    jsonb := '[]'::jsonb;
  v_num     numeric;
  v_cnt     int;
  v_n_verm  int := 0;
  v_n_amar  int := 0;
BEGIN
  -- fail-closed: só empresas do usuário logado
  SELECT array_agg(c) INTO v_allowed FROM get_user_company_ids() AS c;
  IF v_allowed IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'data', p_data,
                              'pendencias', '[]'::jsonb, 'total', 0,
                              'por_gravidade', jsonb_build_object('vermelho',0,'amarelo',0));
  END IF;

  IF p_company_ids IS NULL THEN
    v_cids := v_allowed;
  ELSE
    SELECT array_agg(x) INTO v_cids
    FROM unnest(p_company_ids) x
    WHERE x = ANY (v_allowed);
  END IF;

  IF v_cids IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'data', p_data,
                              'pendencias', '[]'::jsonb, 'total', 0,
                              'por_gravidade', jsonb_build_object('vermelho',0,'amarelo',0));
  END IF;

  FOREACH v_cid IN ARRAY v_cids LOOP
    SELECT nome_fantasia INTO v_nome FROM companies WHERE id = v_cid;
    v_nome  := COALESCE(v_nome, 'Empresa');
    v_caixa := fn_caixa_grupo_dia(ARRAY[v_cid]::uuid[], p_data);

    -- (1) conta com diferença sistema × banco (extrato) ≠ 0 → VERMELHO
    SELECT count(*), COALESCE(sum(abs(s.diferenca)),0)
      INTO v_cnt, v_num
    FROM fn_saldo_gerencial_contas(ARRAY[v_cid]::uuid[]) s
    WHERE s.soma_no_saldo AND s.saldo_extrato IS NOT NULL
      AND abs(COALESCE(s.diferenca,0)) >= 0.01;
    IF v_cnt > 0 THEN
      v_pend := v_pend || jsonb_build_object(
        'tipo','diferenca_banco','empresa',v_nome,'company_id',v_cid,
        'gravidade','vermelho','quantidade',v_cnt,'valor',v_num,
        'texto', v_cnt || ' conta(s) com diferença entre o sistema e o banco — conciliar',
        'link','/dashboard/financeiro/conciliacao');
      v_n_verm := v_n_verm + 1;
    END IF;

    -- (2) extrato desatualizado (> 3 dias) ou conta sem extrato → AMARELO
    SELECT count(*) INTO v_cnt
    FROM erp_banco_contas b
    WHERE b.company_id = v_cid AND b.ativo AND b.soma_no_saldo
      AND b.tipo_conta IN ('corrente','poupanca','aplicacao')
      AND (b.saldo_extrato_em IS NULL OR b.saldo_extrato_em::date < (p_data - 3));
    IF v_cnt > 0 THEN
      v_pend := v_pend || jsonb_build_object(
        'tipo','extrato_desatualizado','empresa',v_nome,'company_id',v_cid,
        'gravidade','amarelo','quantidade',v_cnt,'valor',NULL,
        'texto', v_cnt || ' conta(s) com extrato desatualizado ou sem importar — atualizar o saldo do banco',
        'link','/dashboard/financeiro/extrato');
      v_n_amar := v_n_amar + 1;
    END IF;

    -- (3) lançamentos baixados SEM conta → VERMELHO
    SELECT COALESCE(sum(abs((c->>'saldo_final')::numeric)),0) INTO v_num
    FROM jsonb_array_elements(v_caixa->'empresas') e,
         jsonb_array_elements(e->'contas') c
    WHERE c->>'conta_id' IS NULL AND COALESCE((c->>'saldo_final')::numeric,0) <> 0;
    IF v_num >= 0.01 THEN
      v_pend := v_pend || jsonb_build_object(
        'tipo','lancamento_sem_conta','empresa',v_nome,'company_id',v_cid,
        'gravidade','vermelho','quantidade',NULL,'valor',v_num,
        'texto','Lançamentos baixados sem conta bancária — informar a conta',
        'link','/dashboard/financeiro/conciliacao');
      v_n_verm := v_n_verm + 1;
    END IF;

    -- (4) caixa físico negativo → VERMELHO
    SELECT COALESCE(sum(s.saldo_gerencial),0) INTO v_num
    FROM fn_saldo_gerencial_contas(ARRAY[v_cid]::uuid[]) s
    WHERE s.tipo_conta IN ('caixinha','caixa') AND s.saldo_gerencial < 0;
    IF v_num < 0 THEN
      v_pend := v_pend || jsonb_build_object(
        'tipo','caixa_negativo','empresa',v_nome,'company_id',v_cid,
        'gravidade','vermelho','quantidade',NULL,'valor',v_num,
        'texto','Caixa físico com saldo negativo — revisar lançamentos do caixa',
        'link','/dashboard/financeiro/caixa-grupo');
      v_n_verm := v_n_verm + 1;
    END IF;

    -- (5) a RECEBER atrasado → AMARELO (cobrar)
    v_num := COALESCE((v_caixa #>> '{vence,receber,atrasado}')::numeric, 0);
    IF v_num > 0 THEN
      v_pend := v_pend || jsonb_build_object(
        'tipo','receber_atrasado','empresa',v_nome,'company_id',v_cid,
        'gravidade','amarelo','quantidade',NULL,'valor',v_num,
        'texto','A receber em atraso — cobrar',
        'link','/dashboard/financeiro/receber?situacao=vencidos');
      v_n_amar := v_n_amar + 1;
    END IF;

    -- (5b) a RECEBER vencendo hoje → AMARELO
    v_num := COALESCE((v_caixa #>> '{vence,receber,hoje}')::numeric, 0);
    IF v_num > 0 THEN
      v_pend := v_pend || jsonb_build_object(
        'tipo','receber_hoje','empresa',v_nome,'company_id',v_cid,
        'gravidade','amarelo','quantidade',NULL,'valor',v_num,
        'texto','A receber vencendo hoje',
        'link','/dashboard/financeiro/receber?situacao=hoje');
      v_n_amar := v_n_amar + 1;
    END IF;

    -- (6) a PAGAR atrasado → VERMELHO (pagar)
    v_num := COALESCE((v_caixa #>> '{vence,pagar,atrasado}')::numeric, 0);
    IF v_num > 0 THEN
      v_pend := v_pend || jsonb_build_object(
        'tipo','pagar_atrasado','empresa',v_nome,'company_id',v_cid,
        'gravidade','vermelho','quantidade',NULL,'valor',v_num,
        'texto','A pagar em atraso — regularizar',
        'link','/dashboard/financeiro/pagar?situacao=vencidos');
      v_n_verm := v_n_verm + 1;
    END IF;

    -- (6b) a PAGAR vencendo hoje → AMARELO
    v_num := COALESCE((v_caixa #>> '{vence,pagar,hoje}')::numeric, 0);
    IF v_num > 0 THEN
      v_pend := v_pend || jsonb_build_object(
        'tipo','pagar_hoje','empresa',v_nome,'company_id',v_cid,
        'gravidade','amarelo','quantidade',NULL,'valor',v_num,
        'texto','A pagar vencendo hoje',
        'link','/dashboard/financeiro/pagar?situacao=hoje');
      v_n_amar := v_n_amar + 1;
    END IF;

    -- (10a) despesas a PAGAR sem categoria (afetam o DRE) → AMARELO  [slice 3]
    SELECT count(*), COALESCE(sum(valor),0) INTO v_cnt, v_num
    FROM erp_pagar
    WHERE company_id = v_cid
      AND COALESCE(NULLIF(btrim(categoria), ''), NULL) IS NULL
      AND COALESCE(status, '') <> 'cancelado';
    IF v_cnt > 0 THEN
      v_pend := v_pend || jsonb_build_object(
        'tipo','pagar_sem_categoria','empresa',v_nome,'company_id',v_cid,
        'gravidade','amarelo','quantidade',v_cnt,'valor',v_num,
        'texto', v_cnt || ' despesa(s) sem categoria — classificar p/ o DRE sair certo',
        'link','/dashboard/financeiro/pagar');
      v_n_amar := v_n_amar + 1;
    END IF;

    -- (10b) receitas a RECEBER sem categoria (afetam o DRE) → AMARELO  [slice 3]
    SELECT count(*), COALESCE(sum(valor),0) INTO v_cnt, v_num
    FROM erp_receber
    WHERE company_id = v_cid
      AND COALESCE(NULLIF(btrim(categoria), ''), NULL) IS NULL
      AND COALESCE(status, '') <> 'cancelado';
    IF v_cnt > 0 THEN
      v_pend := v_pend || jsonb_build_object(
        'tipo','receber_sem_categoria','empresa',v_nome,'company_id',v_cid,
        'gravidade','amarelo','quantidade',v_cnt,'valor',v_num,
        'texto', v_cnt || ' receita(s) sem categoria — classificar p/ o DRE sair certo',
        'link','/dashboard/financeiro/receber');
      v_n_amar := v_n_amar + 1;
    END IF;

  END LOOP;

  -- ordena por gravidade (vermelho antes de amarelo), mantendo a ordem de inserção
  SELECT jsonb_agg(p ORDER BY CASE p->>'gravidade' WHEN 'vermelho' THEN 0 ELSE 1 END, ord)
    INTO v_pend
  FROM jsonb_array_elements(v_pend) WITH ORDINALITY AS t(p, ord);

  RETURN jsonb_build_object(
    'ok', true,
    'data', p_data,
    'pendencias', COALESCE(v_pend, '[]'::jsonb),
    'total', v_n_verm + v_n_amar,
    'por_gravidade', jsonb_build_object('vermelho', v_n_verm, 'amarelo', v_n_amar));
END;
$$;

REVOKE ALL ON FUNCTION public.fn_ge_pendencias_dia(uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ge_pendencias_dia(uuid[], date) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_ge_pendencias_dia(uuid[], date) IS
  'P2/CEO 12/11: pendências do dia da Gestão Empresarial para o card "Para tratar hoje". Read-only, fail-closed por get_user_company_ids, reusa fn_caixa_grupo_dia/fn_saldo_gerencial_contas/erp_banco_contas. Slice 1 + Slice 3 (lançamentos sem categoria que afetam o DRE).';
