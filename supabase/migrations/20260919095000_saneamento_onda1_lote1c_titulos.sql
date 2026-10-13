-- 🚨 Saneamento Onda 1 · Lote 1c — criadores de título com parcelas (inventário #1560). Contexto 6b5cad70.
-- RDs 25·38·65·34-V5. Todas têm p_company_id → guarda padrão direta. Sem JWT (interno/cron)/service_role/
-- admin passa; authenticated só na própria empresa (senão 42501). REVOKE anon/public; GRANT
-- authenticated, service_role. Assinatura/retorno inalterados; corpo reproduzido fiel de produção.

-- ── fn_receber_criar_com_parcelas ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_receber_criar_com_parcelas(p_company_id uuid, p_cliente_id uuid, p_cliente_nome text, p_descricao text, p_valor_total numeric, p_data_emissao date, p_data_primeiro_recebimento date, p_total_parcelas integer DEFAULT 1, p_categoria text DEFAULT NULL::text, p_numero_documento text DEFAULT NULL::text, p_forma_recebimento text DEFAULT NULL::text, p_observacao text DEFAULT NULL::text, p_intervalo_dias integer DEFAULT 30, p_status_inicial text DEFAULT 'aberto'::text, p_conta_bancaria text DEFAULT NULL::text, p_forcar_dup boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_valor_parcela numeric; v_valor_atual numeric; v_data_venc date; i int;
  v_status text; v_ids uuid[] := ARRAY[]::uuid[]; v_id uuid; v_grupo uuid := gen_random_uuid();
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active')
  THEN RETURN jsonb_build_object('sem_plano', true); END IF;
  IF p_forcar_dup THEN PERFORM set_config('app.forcar_titulo_dup','1', true); END IF;
  IF p_total_parcelas < 1 THEN p_total_parcelas := 1; END IF;
  v_status := CASE WHEN COALESCE(p_status_inicial,'') IN ('aberto','pago','parcial','vencido','cancelado')
    THEN p_status_inicial ELSE 'aberto' END;
  v_valor_parcela := ROUND(p_valor_total / p_total_parcelas, 2);
  FOR i IN 1..p_total_parcelas LOOP
    v_data_venc := p_data_primeiro_recebimento + ((i - 1) * p_intervalo_dias);
    v_valor_atual := CASE WHEN i = p_total_parcelas
      THEN p_valor_total - (v_valor_parcela * (p_total_parcelas - 1)) ELSE v_valor_parcela END;
    INSERT INTO erp_receber (
      company_id, cliente_id, cliente_nome, data_emissao, data_vencimento,
      valor, status, categoria, numero_documento, descricao,
      forma_pagamento, observacoes, conta_bancaria, created_at, parcela_grupo_id
    ) VALUES (
      p_company_id, p_cliente_id, p_cliente_nome, p_data_emissao, v_data_venc,
      v_valor_atual, v_status, p_categoria,
      CASE WHEN p_total_parcelas > 1 THEN COALESCE(p_numero_documento,'') || ' ' || i || '/' || p_total_parcelas ELSE p_numero_documento END,
      p_descricao || CASE WHEN p_total_parcelas > 1 THEN ' ('||i||'/'||p_total_parcelas||')' ELSE '' END,
      p_forma_recebimento, p_observacao, p_conta_bancaria, NOW(),
      CASE WHEN p_total_parcelas > 1 THEN v_grupo ELSE NULL END
    ) RETURNING id INTO v_id;
    v_ids := array_append(v_ids, v_id);
  END LOOP;
  RETURN jsonb_build_object('success', true, 'qtd_parcelas_criadas', p_total_parcelas,
    'valor_por_parcela', v_valor_parcela, 'status_inicial', v_status, 'ids', to_jsonb(v_ids));
END; $function$;

-- ── fn_pagar_criar_com_parcelas ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pagar_criar_com_parcelas(p_company_id uuid, p_fornecedor_id uuid, p_fornecedor_nome text, p_descricao text, p_valor_total numeric, p_data_emissao date, p_data_primeiro_vencimento date, p_total_parcelas integer DEFAULT 1, p_categoria text DEFAULT NULL::text, p_numero_documento text DEFAULT NULL::text, p_forma_pagamento text DEFAULT NULL::text, p_observacao text DEFAULT NULL::text, p_intervalo_dias integer DEFAULT 30, p_conta_bancaria text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_valor_parcela numeric; v_valor_atual numeric; v_data_venc date; i int;
  v_ids uuid[] := ARRAY[]::uuid[]; v_id uuid; v_grupo uuid := gen_random_uuid();
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
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
      forma_pagamento, observacoes, conta_bancaria, created_at, parcela_grupo_id
    ) VALUES (
      p_company_id, p_fornecedor_id, p_fornecedor_nome, p_data_emissao, v_data_venc,
      v_valor_atual, 'aberto', p_categoria,
      CASE WHEN p_total_parcelas > 1
        THEN COALESCE(p_numero_documento,'') || ' ' || i || '/' || p_total_parcelas
        ELSE p_numero_documento END,
      p_descricao || CASE WHEN p_total_parcelas > 1 THEN ' ('||i||'/'||p_total_parcelas||')' ELSE '' END,
      p_forma_pagamento, p_observacao, p_conta_bancaria, NOW(),
      CASE WHEN p_total_parcelas > 1 THEN v_grupo ELSE NULL END
    ) RETURNING id INTO v_id;
    v_ids := array_append(v_ids, v_id);
  END LOOP;
  RETURN jsonb_build_object('success', true, 'qtd_parcelas_criadas', p_total_parcelas,
    'valor_por_parcela', v_valor_parcela, 'ids', to_jsonb(v_ids));
END; $function$;

-- ── fn_veic__receber (interno; tem p_company_id → guarda padrão) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic__receber(p_company_id uuid, p_ref_id uuid, p_descricao text, p_valor numeric, p_vencimento date, p_cliente_id uuid, p_cliente_nome text, p_forma text, p_conta uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
  INSERT INTO erp_receber (company_id, valor, descricao, data_vencimento, data_emissao, status,
      cliente_id, cliente_nome, categoria, forma_pagamento, conta_bancaria_id,
      ref_externa_sistema, ref_externa_id)
  VALUES (p_company_id, p_valor, p_descricao, COALESCE(p_vencimento, CURRENT_DATE), CURRENT_DATE, 'aberto',
      p_cliente_id, p_cliente_nome, 'Revenda de veículos', p_forma, p_conta,
      'revenda_veiculos', p_ref_id::text)
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

-- ── ACL ────────────────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.fn_receber_criar_com_parcelas(uuid,uuid,text,text,numeric,date,date,integer,text,text,text,text,integer,text,text,boolean) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_receber_criar_com_parcelas(uuid,uuid,text,text,numeric,date,date,integer,text,text,text,text,integer,text,text,boolean) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_pagar_criar_com_parcelas(uuid,uuid,text,text,numeric,date,date,integer,text,text,text,text,integer,text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_pagar_criar_com_parcelas(uuid,uuid,text,text,numeric,date,date,integer,text,text,text,text,integer,text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_veic__receber(uuid,uuid,text,numeric,date,uuid,text,text,uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_veic__receber(uuid,uuid,text,numeric,date,uuid,text,text,uuid) TO authenticated, service_role;
