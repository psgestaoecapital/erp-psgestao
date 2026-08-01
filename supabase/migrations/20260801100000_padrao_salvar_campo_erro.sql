-- RD-41 · Padrão de "erro de salvamento" (piloto) — Parte 1: contrato de erro.
-- Aditivo: acrescenta `campo` nos erros de VALIDAÇÃO das RPCs das 2 telas piloto,
-- pro front destacar em vermelho o input certo. sem_acesso/sem_plano ficam sem
-- `campo` (vão só pro banner). Nada mais muda nas funções.

CREATE OR REPLACE FUNCTION public.fn_pagar_criar_com_parcelas_v2(p_company_id uuid, p_fornecedor_id uuid, p_fornecedor_nome text, p_descricao text, p_data_emissao date, p_categoria text DEFAULT NULL::text, p_numero_documento text DEFAULT NULL::text, p_forma_pagamento text DEFAULT NULL::text, p_observacao text DEFAULT NULL::text, p_conta_bancaria text DEFAULT NULL::text, p_parcelas jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_total int; v_ids uuid[] := ARRAY[]::uuid[]; v_id uuid;
  v_soma numeric := 0; r jsonb; i int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active')
  THEN RETURN jsonb_build_object('sem_plano', true); END IF;
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;
  v_total := COALESCE(jsonb_array_length(p_parcelas), 0);
  IF v_total < 1 THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_parcelas', 'campo', 'parcelas'); END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_parcelas) LOOP
    i := i + 1;
    IF NULLIF(r->>'valor','') IS NULL OR NULLIF(r->>'data_vencimento','') IS NULL THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'parcela_incompleta', 'indice', i, 'campo', 'parcelas');
    END IF;
    INSERT INTO erp_pagar (
      company_id, fornecedor_id, fornecedor_nome, data_emissao, data_vencimento,
      valor, status, categoria, numero_documento, descricao, parcela,
      forma_pagamento, observacoes, conta_bancaria, data_competencia, created_at
    ) VALUES (
      p_company_id, p_fornecedor_id, p_fornecedor_nome, p_data_emissao,
      (r->>'data_vencimento')::date,
      (r->>'valor')::numeric, 'aberto', p_categoria, p_numero_documento, p_descricao,
      COALESCE(NULLIF(r->>'n',''), i::text) || '/' || v_total,
      p_forma_pagamento, p_observacao, p_conta_bancaria,
      NULLIF(r->>'data_competencia','')::date, NOW()
    ) RETURNING id INTO v_id;
    v_ids := array_append(v_ids, v_id);
    v_soma := v_soma + (r->>'valor')::numeric;
  END LOOP;
  RETURN jsonb_build_object('sucesso', true, 'qtd_parcelas_criadas', v_total,
    'valor_total', v_soma, 'ids', to_jsonb(v_ids));
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_receber_criar_com_parcelas_v2(p_company_id uuid, p_cliente_id uuid, p_cliente_nome text, p_descricao text, p_data_emissao date, p_categoria text DEFAULT NULL::text, p_numero_documento text DEFAULT NULL::text, p_forma_recebimento text DEFAULT NULL::text, p_observacao text DEFAULT NULL::text, p_conta_bancaria text DEFAULT NULL::text, p_status_inicial text DEFAULT 'aberto'::text, p_parcelas jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_total int; v_ids uuid[] := ARRAY[]::uuid[]; v_id uuid; v_soma numeric := 0; r jsonb; i int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active')
  THEN RETURN jsonb_build_object('sem_plano', true); END IF;
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;
  v_total := COALESCE(jsonb_array_length(p_parcelas), 0);
  IF v_total < 1 THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_parcelas', 'campo', 'parcelas'); END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_parcelas) LOOP
    i := i + 1;
    IF NULLIF(r->>'valor','') IS NULL OR NULLIF(r->>'data_vencimento','') IS NULL THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'parcela_incompleta', 'indice', i, 'campo', 'parcelas');
    END IF;
    INSERT INTO erp_receber (
      company_id, cliente_id, cliente_nome, data_emissao, data_vencimento,
      valor, status, categoria, numero_documento, descricao, parcela,
      forma_pagamento, observacoes, conta_bancaria, data_competencia, created_at
    ) VALUES (
      p_company_id, p_cliente_id, p_cliente_nome, p_data_emissao, (r->>'data_vencimento')::date,
      (r->>'valor')::numeric, COALESCE(p_status_inicial,'aberto'), p_categoria, p_numero_documento, p_descricao,
      COALESCE(NULLIF(r->>'n',''), i::text) || '/' || v_total,
      p_forma_recebimento, p_observacao, p_conta_bancaria, NULLIF(r->>'data_competencia','')::date, NOW()
    ) RETURNING id INTO v_id;
    v_ids := array_append(v_ids, v_id);
    v_soma := v_soma + (r->>'valor')::numeric;
  END LOOP;
  RETURN jsonb_build_object('sucesso', true, 'qtd_parcelas_criadas', v_total,
    'valor_total', v_soma, 'ids', to_jsonb(v_ids));
END; $function$;