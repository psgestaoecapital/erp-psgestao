-- ============================================================
-- Pacote Jordana (cristalizacao de drift + novidades deste PR)
-- Aplicada via MCP em 2026-06-26 — versionada aqui pra ficar no repo.
--
-- 1) DRIFT (RPCs ja em producao desde sessao anterior — SPEC #5)
--    fn_receber_registrar_recebimento / fn_pagar_registrar_pagamento
--    Acumulam valor_pago e marcam status='parcial' enquanto saldo > 0,01.
-- 2) NOVO (SPEC #2): fn_orcamento_editar — edita itens/totais com
--    liberacao por dono/admin/gestor; versionamento opcional.
-- 3) NOVO (SPEC #3): view v_erp_produtos_estoque com status_estoque
--    derivado (zerado/abaixo_minimo/ok) — viabiliza filtro server-side.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_receber_registrar_recebimento(
  p_receber_id uuid,
  p_data_pagamento date,
  p_valor_recebido numeric,
  p_forma_pagamento text DEFAULT 'PIX'::text,
  p_conta_bancaria_id uuid DEFAULT NULL::uuid,
  p_observacao text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_r record; v_pago_acum numeric; v_saldo numeric; v_status text;
BEGIN
  SELECT * INTO v_r FROM erp_receber WHERE id = p_receber_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso',false,'erro','Conta a receber nao encontrada'); END IF;
  IF v_r.status = 'pago' THEN RETURN jsonb_build_object('sucesso',false,'erro','Conta ja esta paga'); END IF;
  IF v_r.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Sem permissao'); END IF;

  v_pago_acum := round(COALESCE(v_r.valor_pago,0) + p_valor_recebido, 2);
  v_saldo     := round(v_r.valor - v_pago_acum, 2);
  v_status    := CASE WHEN v_pago_acum >= v_r.valor - 0.01 THEN 'pago' ELSE 'parcial' END;

  UPDATE erp_receber
  SET valor_pago = v_pago_acum,
      status = v_status,
      data_pagamento = p_data_pagamento,
      forma_pagamento = p_forma_pagamento,
      observacoes = COALESCE(observacoes,'') ||
        COALESCE(' [PARCIAL '||to_char(p_data_pagamento,'DD/MM')||': R$'||p_valor_recebido||COALESCE(' - '||p_observacao,'')||']',''),
      updated_at = NOW()
  WHERE id = p_receber_id;

  RETURN jsonb_build_object('sucesso',true,'valor_recebido',p_valor_recebido,
    'pago_acumulado',v_pago_acum,'saldo_restante',GREATEST(v_saldo,0),'status',v_status);
END; $$;

CREATE OR REPLACE FUNCTION public.fn_pagar_registrar_pagamento(
  p_pagar_id uuid,
  p_data_pagamento date,
  p_valor_pago numeric,
  p_forma_pagamento text DEFAULT 'PIX'::text,
  p_conta_bancaria_id uuid DEFAULT NULL::uuid,
  p_observacao text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_p record; v_pago_acum numeric; v_saldo numeric; v_status text;
BEGIN
  SELECT * INTO v_p FROM erp_pagar WHERE id = p_pagar_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso',false,'erro','Conta a pagar nao encontrada'); END IF;
  IF v_p.status = 'pago' THEN RETURN jsonb_build_object('sucesso',false,'erro','Conta ja esta paga'); END IF;
  IF v_p.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Sem permissao'); END IF;

  v_pago_acum := round(COALESCE(v_p.valor_pago,0) + p_valor_pago, 2);
  v_saldo     := round(v_p.valor - v_pago_acum, 2);
  v_status    := CASE WHEN v_pago_acum >= v_p.valor - 0.01 THEN 'pago' ELSE 'parcial' END;

  UPDATE erp_pagar
  SET valor_pago = v_pago_acum,
      status = v_status,
      data_pagamento = p_data_pagamento,
      forma_pagamento = p_forma_pagamento,
      observacoes = COALESCE(observacoes,'') ||
        COALESCE(' [PARCIAL '||to_char(p_data_pagamento,'DD/MM')||': R$'||p_valor_pago||COALESCE(' - '||p_observacao,'')||']',''),
      updated_at = NOW()
  WHERE id = p_pagar_id;

  RETURN jsonb_build_object('sucesso',true,'valor_pago_parcela',p_valor_pago,
    'pago_acumulado',v_pago_acum,'saldo_restante',GREATEST(v_saldo,0),'status',v_status);
END; $$;

-- SPEC #2: fn_orcamento_editar (nova)
CREATE OR REPLACE FUNCTION public.fn_orcamento_editar(
  p_orcamento_id uuid,
  p_itens jsonb,
  p_desconto_valor numeric DEFAULT 0,
  p_observacoes text DEFAULT NULL,
  p_versionar boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_orc record; v_uid uuid := auth.uid(); v_alvo uuid;
  v_pode boolean; v_novo_total numeric;
BEGIN
  SELECT * INTO v_orc FROM erp_orcamentos WHERE id = p_orcamento_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','Orcamento nao encontrado'); END IF;
  IF v_orc.company_id NOT IN (SELECT get_user_company_ids()) AND NOT is_admin() THEN
    RETURN jsonb_build_object('ok',false,'erro','Sem permissao para esta empresa');
  END IF;
  IF v_orc.status IN ('aprovado','convertido','cancelado','venda_avulsa') THEN
    RETURN jsonb_build_object('ok',false,'erro','Orcamento '||v_orc.status||' nao pode ser alterado');
  END IF;
  v_pode := (v_orc.created_by = v_uid)
            OR is_admin()
            OR EXISTS (
                 SELECT 1 FROM tenant_user_roles r
                 WHERE r.user_id = v_uid AND r.company_id = v_orc.company_id AND r.is_active
                   AND (r.role ILIKE '%MASTER%' OR r.role ILIKE '%OWNER%'
                        OR r.role ILIKE '%MANAGER%' OR r.role ILIKE '%ADMIN%')
               );
  IF NOT v_pode THEN RETURN jsonb_build_object('ok',false,'erro','Sem liberacao para editar este orcamento'); END IF;

  IF p_versionar AND v_orc.status IN ('enviado','visualizado') THEN
    INSERT INTO erp_orcamentos (company_id, numero, versao, orcamento_origem_id, cliente_id, cliente_nome,
      cliente_cnpj, status, vendedor_id, vendedor_nome, condicao_pagamento, forma_pagamento, created_by)
    SELECT company_id, numero, COALESCE(versao,1)+1, COALESCE(orcamento_origem_id, id), cliente_id, cliente_nome,
      cliente_cnpj, 'rascunho', vendedor_id, vendedor_nome, condicao_pagamento, forma_pagamento, v_uid
    FROM erp_orcamentos WHERE id = p_orcamento_id
    RETURNING id INTO v_alvo;
  ELSE
    v_alvo := p_orcamento_id;
    DELETE FROM erp_orcamentos_itens WHERE orcamento_id = v_alvo;
  END IF;

  INSERT INTO erp_orcamentos_itens (orcamento_id, company_id, ordem, produto_id, produto_codigo, produto_nome,
    unidade, quantidade, preco_unitario, preco_custo, desconto_percentual, desconto_valor, subtotal, tipo_item)
  SELECT v_alvo, v_orc.company_id,
    ROW_NUMBER() OVER (), NULLIF(i->>'produto_id','')::uuid, i->>'produto_codigo', i->>'produto_nome',
    i->>'unidade', (i->>'quantidade')::numeric, (i->>'preco_unitario')::numeric,
    COALESCE((i->>'preco_custo')::numeric,0), COALESCE((i->>'desconto_percentual')::numeric,0),
    COALESCE((i->>'desconto_valor')::numeric,0),
    (i->>'quantidade')::numeric * (i->>'preco_unitario')::numeric - COALESCE((i->>'desconto_valor')::numeric,0),
    COALESCE(i->>'tipo_item','produto')
  FROM jsonb_array_elements(p_itens) i;

  SELECT COALESCE(SUM(subtotal),0) INTO v_novo_total FROM erp_orcamentos_itens WHERE orcamento_id = v_alvo;
  UPDATE erp_orcamentos
     SET subtotal = v_novo_total,
         desconto_valor = COALESCE(p_desconto_valor,0),
         total = v_novo_total - COALESCE(p_desconto_valor,0),
         observacoes = COALESCE(p_observacoes, observacoes),
         updated_at = now()
   WHERE id = v_alvo;

  INSERT INTO erp_orcamento_historico (orcamento_id, company_id, evento, detalhe, usuario_id, created_at)
  VALUES (v_alvo, v_orc.company_id, 'ALTEROU',
          'Itens/valores alterados'||CASE WHEN v_alvo<>p_orcamento_id THEN ' (nova versao)' ELSE '' END,
          v_uid, now());

  RETURN jsonb_build_object('ok',true,'orcamento_id',v_alvo,'novo_total',v_novo_total,
                            'versionado', v_alvo <> p_orcamento_id);
END $$;

GRANT EXECUTE ON FUNCTION public.fn_orcamento_editar(uuid, jsonb, numeric, text, boolean) TO authenticated;

-- SPEC #3: view derivada com status_estoque
CREATE OR REPLACE VIEW public.v_erp_produtos_estoque WITH (security_invoker=on) AS
SELECT
  p.*,
  CASE
    WHEN COALESCE(p.estoque_atual, 0) = 0 THEN 'zerado'
    WHEN p.estoque_minimo IS NOT NULL AND COALESCE(p.estoque_atual, 0) < p.estoque_minimo THEN 'abaixo_minimo'
    ELSE 'ok'
  END AS status_estoque
FROM public.erp_produtos p;
