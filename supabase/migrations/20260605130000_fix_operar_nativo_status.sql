-- =============================================================
-- FIX-OPERAR-NATIVO-STATUS-v1
-- =============================================================
-- Bug: fn_pagar_criar_com_parcelas inseria status='pendente' hardcoded,
-- violando a constraint erp_pagar.status IN (aberto|pago|parcial|vencido|cancelado).
-- Toda "Nova despesa" nativa falhava (latente pq KGF so importava do Omie).
-- fn_receber_criar_com_parcelas tinha o mesmo risco via p_status_inicial.
--
-- Fix: status -> 'aberto' por default + normalizacao defensiva.
-- Bonus: ultima parcela absorve o resto do arredondamento pra somar
-- exatamente o total (100/3 = 33.33 + 33.33 + 33.34).
-- =============================================================

CREATE OR REPLACE FUNCTION public.fn_receber_criar_com_parcelas(
  p_company_id uuid, p_cliente_id uuid, p_cliente_nome text, p_descricao text,
  p_valor_total numeric, p_data_emissao date, p_data_primeiro_recebimento date,
  p_total_parcelas integer DEFAULT 1, p_categoria text DEFAULT NULL,
  p_numero_documento text DEFAULT NULL, p_forma_recebimento text DEFAULT NULL,
  p_observacao text DEFAULT NULL, p_intervalo_dias integer DEFAULT 30,
  p_status_inicial text DEFAULT 'aberto', p_conta_bancaria text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_valor_parcela numeric; v_valor_atual numeric; v_data_venc date; i int;
  v_status text; v_ids uuid[] := ARRAY[]::uuid[]; v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active')
  THEN RETURN jsonb_build_object('sem_plano', true); END IF;

  IF p_total_parcelas < 1 THEN p_total_parcelas := 1; END IF;

  -- normaliza status (constraint: aberto/pago/parcial/vencido/cancelado)
  v_status := CASE
    WHEN COALESCE(p_status_inicial,'') IN ('aberto','pago','parcial','vencido','cancelado')
    THEN p_status_inicial ELSE 'aberto' END;

  v_valor_parcela := ROUND(p_valor_total / p_total_parcelas, 2);

  FOR i IN 1..p_total_parcelas LOOP
    v_data_venc := p_data_primeiro_recebimento + ((i - 1) * p_intervalo_dias);
    -- ultima parcela absorve o resto pra somar exatamente o total
    v_valor_atual := CASE WHEN i = p_total_parcelas
      THEN p_valor_total - (v_valor_parcela * (p_total_parcelas - 1))
      ELSE v_valor_parcela END;
    INSERT INTO erp_receber (
      company_id, cliente_id, cliente_nome, data_emissao, data_vencimento,
      valor, status, categoria, numero_documento, descricao,
      forma_pagamento, observacoes, conta_bancaria, created_at
    ) VALUES (
      p_company_id, p_cliente_id, p_cliente_nome, p_data_emissao, v_data_venc,
      v_valor_atual, v_status, p_categoria,
      CASE WHEN p_total_parcelas > 1
        THEN COALESCE(p_numero_documento,'') || ' ' || i || '/' || p_total_parcelas
        ELSE p_numero_documento END,
      p_descricao || CASE WHEN p_total_parcelas > 1 THEN ' ('||i||'/'||p_total_parcelas||')' ELSE '' END,
      p_forma_recebimento, p_observacao, p_conta_bancaria, NOW()
    ) RETURNING id INTO v_id;
    v_ids := array_append(v_ids, v_id);
  END LOOP;

  RETURN jsonb_build_object('success', true, 'qtd_parcelas_criadas', p_total_parcelas,
    'valor_por_parcela', v_valor_parcela, 'status_inicial', v_status, 'ids', to_jsonb(v_ids));
END;
$function$;


CREATE OR REPLACE FUNCTION public.fn_pagar_criar_com_parcelas(
  p_company_id uuid, p_fornecedor_id uuid, p_fornecedor_nome text, p_descricao text,
  p_valor_total numeric, p_data_emissao date, p_data_primeiro_vencimento date,
  p_total_parcelas integer DEFAULT 1, p_categoria text DEFAULT NULL,
  p_numero_documento text DEFAULT NULL, p_forma_pagamento text DEFAULT NULL,
  p_observacao text DEFAULT NULL, p_intervalo_dias integer DEFAULT 30,
  p_conta_bancaria text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_valor_parcela numeric; v_valor_atual numeric; v_data_venc date; i int;
  v_ids uuid[] := ARRAY[]::uuid[]; v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active')
  THEN RETURN jsonb_build_object('sem_plano', true); END IF;

  IF p_total_parcelas < 1 THEN p_total_parcelas := 1; END IF;
  v_valor_parcela := ROUND(p_valor_total / p_total_parcelas, 2);

  FOR i IN 1..p_total_parcelas LOOP
    v_data_venc := p_data_primeiro_vencimento + ((i - 1) * p_intervalo_dias);
    v_valor_atual := CASE WHEN i = p_total_parcelas
      THEN p_valor_total - (v_valor_parcela * (p_total_parcelas - 1))
      ELSE v_valor_parcela END;
    INSERT INTO erp_pagar (
      company_id, fornecedor_id, fornecedor_nome, data_emissao, data_vencimento,
      valor, status, categoria, numero_documento, descricao,
      forma_pagamento, observacoes, conta_bancaria, created_at
    ) VALUES (
      p_company_id, p_fornecedor_id, p_fornecedor_nome, p_data_emissao, v_data_venc,
      v_valor_atual, 'aberto', p_categoria,
      CASE WHEN p_total_parcelas > 1
        THEN COALESCE(p_numero_documento,'') || ' ' || i || '/' || p_total_parcelas
        ELSE p_numero_documento END,
      p_descricao || CASE WHEN p_total_parcelas > 1 THEN ' ('||i||'/'||p_total_parcelas||')' ELSE '' END,
      p_forma_pagamento, p_observacao, p_conta_bancaria, NOW()
    ) RETURNING id INTO v_id;
    v_ids := array_append(v_ids, v_id);
  END LOOP;

  RETURN jsonb_build_object('success', true, 'qtd_parcelas_criadas', p_total_parcelas,
    'valor_por_parcela', v_valor_parcela, 'ids', to_jsonb(v_ids));
END;
$function$;

COMMENT ON FUNCTION public.fn_receber_criar_com_parcelas IS
  'Cria parcelas em erp_receber. status default aberto · ultima parcela ajusta arredondamento. FIX-OPERAR-NATIVO-STATUS-v1.';
COMMENT ON FUNCTION public.fn_pagar_criar_com_parcelas IS
  'Cria parcelas em erp_pagar. status hardcoded aberto · ultima parcela ajusta arredondamento. FIX-OPERAR-NATIVO-STATUS-v1.';
