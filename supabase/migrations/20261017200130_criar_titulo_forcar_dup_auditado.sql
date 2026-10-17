-- Antiduplicidade Parte 2 (CEO 14/10): quando o usuário CONFIRMA lançar uma despesa/receita que o banco recusou por
-- duplicidade (23505 de fn_titulo_antidup), a RPC que cria passa a aceitar p_forcar_dup. Decisões do CEO:
--  (a) forçar pela MESMA flag app.forcar_titulo_dup, com SET LOCAL só dentro da RPC (nunca na sessão inteira);
--  (b) registrar "quem confirmou" em audit_log_global (acao 'CRIOU', motivo "duplicidade confirmada pelo usuário",
--      com o id do título parecido que já existia) — sem criar colunas novas no título.
--
-- Mantém toda a lógica atual das fn_*_criar_com_parcelas_v2; só acrescenta o parâmetro no FIM. Para não criar overload
-- (PGRST203 / gate check-rpc-overload), DROPa a assinatura antiga e recria com o parâmetro novo (DEFAULT false → as
-- chamadas atuais, por nome, seguem funcionando). CREATE OR REPLACE de função de financeiro → via revisada.

DROP FUNCTION IF EXISTS public.fn_pagar_criar_com_parcelas_v2(uuid,uuid,text,text,date,text,text,text,text,text,jsonb);

CREATE FUNCTION public.fn_pagar_criar_com_parcelas_v2(
  p_company_id uuid, p_fornecedor_id uuid, p_fornecedor_nome text, p_descricao text, p_data_emissao date,
  p_categoria text DEFAULT NULL::text, p_numero_documento text DEFAULT NULL::text, p_forma_pagamento text DEFAULT NULL::text,
  p_observacao text DEFAULT NULL::text, p_conta_bancaria text DEFAULT NULL::text, p_parcelas jsonb DEFAULT '[]'::jsonb,
  p_forcar_dup boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total int; v_ids uuid[] := ARRAY[]::uuid[]; v_id uuid;
  v_soma numeric := 0; r jsonb; i int := 0; v_grupo uuid := gen_random_uuid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active')
  THEN RETURN jsonb_build_object('sem_plano', true); END IF;
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;
  -- (a) só o usuário confirmando "lançar mesmo assim" força, e a flag vale SÓ nesta transação (is_local=true).
  IF p_forcar_dup THEN PERFORM set_config('app.forcar_titulo_dup', '1', true); END IF;
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
      forma_pagamento, observacoes, conta_bancaria, data_competencia, created_at, parcela_grupo_id
    ) VALUES (
      p_company_id, p_fornecedor_id, p_fornecedor_nome, p_data_emissao,
      (r->>'data_vencimento')::date,
      (r->>'valor')::numeric, 'aberto', p_categoria, p_numero_documento, p_descricao,
      COALESCE(NULLIF(r->>'n',''), i::text) || '/' || v_total,
      p_forma_pagamento, p_observacao, p_conta_bancaria,
      NULLIF(r->>'data_competencia','')::date, NOW(),
      CASE WHEN v_total > 1 THEN v_grupo ELSE NULL END
    ) RETURNING id INTO v_id;
    v_ids := array_append(v_ids, v_id);
    v_soma := v_soma + (r->>'valor')::numeric;
  END LOOP;
  -- (b) auditoria: só os títulos criados que TINHAM um parecido vivo (a duplicidade que o usuário confirmou).
  IF p_forcar_dup THEN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_novo, created_at)
    SELECT p_company_id, auth.uid(),
           NULLIF((current_setting('request.jwt.claims', true))::jsonb->>'email',''),
           'erp_pagar', n.id::text, 'CRIOU',
           jsonb_build_object('motivo','duplicidade confirmada pelo usuário','titulo_similar_id', sim.id,
                              'descricao', n.descricao, 'valor', n.valor, 'data_vencimento', n.data_vencimento),
           NOW()
    FROM erp_pagar n
    JOIN LATERAL (
      SELECT e.id FROM erp_pagar e
      WHERE e.company_id = p_company_id AND e.descricao = n.descricao AND e.valor = n.valor
        AND e.data_vencimento = n.data_vencimento AND e.id <> n.id
        AND e.deleted_at IS NULL AND lower(COALESCE(e.status,'')) NOT IN ('cancelado')
      ORDER BY e.created_at LIMIT 1
    ) sim ON true
    WHERE n.id = ANY(v_ids);
  END IF;
  RETURN jsonb_build_object('sucesso', true, 'qtd_parcelas_criadas', v_total,
    'valor_total', v_soma, 'ids', to_jsonb(v_ids));
END; $function$;

REVOKE ALL ON FUNCTION public.fn_pagar_criar_com_parcelas_v2(uuid,uuid,text,text,date,text,text,text,text,text,jsonb,boolean) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_pagar_criar_com_parcelas_v2(uuid,uuid,text,text,date,text,text,text,text,text,jsonb,boolean) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.fn_receber_criar_com_parcelas_v2(uuid,uuid,text,text,date,text,text,text,text,text,text,jsonb);

CREATE FUNCTION public.fn_receber_criar_com_parcelas_v2(
  p_company_id uuid, p_cliente_id uuid, p_cliente_nome text, p_descricao text, p_data_emissao date,
  p_categoria text DEFAULT NULL::text, p_numero_documento text DEFAULT NULL::text, p_forma_recebimento text DEFAULT NULL::text,
  p_observacao text DEFAULT NULL::text, p_conta_bancaria text DEFAULT NULL::text, p_status_inicial text DEFAULT 'aberto'::text,
  p_parcelas jsonb DEFAULT '[]'::jsonb, p_forcar_dup boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_total int; v_ids uuid[] := ARRAY[]::uuid[]; v_id uuid; v_soma numeric := 0; r jsonb; i int := 0; v_grupo uuid := gen_random_uuid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active')
  THEN RETURN jsonb_build_object('sem_plano', true); END IF;
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;
  IF p_forcar_dup THEN PERFORM set_config('app.forcar_titulo_dup', '1', true); END IF;
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
      forma_pagamento, observacoes, conta_bancaria, data_competencia, created_at, parcela_grupo_id
    ) VALUES (
      p_company_id, p_cliente_id, p_cliente_nome, p_data_emissao, (r->>'data_vencimento')::date,
      (r->>'valor')::numeric, COALESCE(p_status_inicial,'aberto'), p_categoria, p_numero_documento, p_descricao,
      COALESCE(NULLIF(r->>'n',''), i::text) || '/' || v_total,
      p_forma_recebimento, p_observacao, p_conta_bancaria, NULLIF(r->>'data_competencia','')::date, NOW(),
      CASE WHEN v_total > 1 THEN v_grupo ELSE NULL END
    ) RETURNING id INTO v_id;
    v_ids := array_append(v_ids, v_id);
    v_soma := v_soma + (r->>'valor')::numeric;
  END LOOP;
  IF p_forcar_dup THEN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_novo, created_at)
    SELECT p_company_id, auth.uid(),
           NULLIF((current_setting('request.jwt.claims', true))::jsonb->>'email',''),
           'erp_receber', n.id::text, 'CRIOU',
           jsonb_build_object('motivo','duplicidade confirmada pelo usuário','titulo_similar_id', sim.id,
                              'descricao', n.descricao, 'valor', n.valor, 'data_vencimento', n.data_vencimento),
           NOW()
    FROM erp_receber n
    JOIN LATERAL (
      SELECT e.id FROM erp_receber e
      WHERE e.company_id = p_company_id AND e.descricao = n.descricao AND e.valor = n.valor
        AND e.data_vencimento = n.data_vencimento AND e.id <> n.id
        AND e.deleted_at IS NULL AND lower(COALESCE(e.status,'')) NOT IN ('cancelado')
      ORDER BY e.created_at LIMIT 1
    ) sim ON true
    WHERE n.id = ANY(v_ids);
  END IF;
  RETURN jsonb_build_object('sucesso', true, 'qtd_parcelas_criadas', v_total,
    'valor_total', v_soma, 'ids', to_jsonb(v_ids));
END; $function$;

REVOKE ALL ON FUNCTION public.fn_receber_criar_com_parcelas_v2(uuid,uuid,text,text,date,text,text,text,text,text,text,jsonb,boolean) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_receber_criar_com_parcelas_v2(uuid,uuid,text,text,date,text,text,text,text,text,text,jsonb,boolean) TO authenticated, service_role;

-- ── v1 (1 parcela): a Nova Despesa de 1 parcela chama a v1, que NÃO tinha p_forcar_dup → adiciona (DROP+CREATE p/ não
-- criar overload). A v1 de receber já tinha o flag; aqui só ganha a auditoria. Mesma guarda/retorno originais preservados.
DROP FUNCTION IF EXISTS public.fn_pagar_criar_com_parcelas(uuid,uuid,text,text,numeric,date,date,integer,text,text,text,text,integer,text);

CREATE FUNCTION public.fn_pagar_criar_com_parcelas(
  p_company_id uuid, p_fornecedor_id uuid, p_fornecedor_nome text, p_descricao text, p_valor_total numeric,
  p_data_emissao date, p_data_primeiro_vencimento date, p_total_parcelas integer DEFAULT 1, p_categoria text DEFAULT NULL::text,
  p_numero_documento text DEFAULT NULL::text, p_forma_pagamento text DEFAULT NULL::text, p_observacao text DEFAULT NULL::text,
  p_intervalo_dias integer DEFAULT 30, p_conta_bancaria text DEFAULT NULL::text, p_forcar_dup boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  IF p_forcar_dup THEN PERFORM set_config('app.forcar_titulo_dup','1', true); END IF;
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
  IF p_forcar_dup THEN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_novo, created_at)
    SELECT p_company_id, auth.uid(), NULLIF((current_setting('request.jwt.claims', true))::jsonb->>'email',''),
           'erp_pagar', n.id::text, 'CRIOU',
           jsonb_build_object('motivo','duplicidade confirmada pelo usuário','titulo_similar_id', sim.id,
                              'descricao', n.descricao, 'valor', n.valor, 'data_vencimento', n.data_vencimento), NOW()
    FROM erp_pagar n
    JOIN LATERAL (
      SELECT e.id FROM erp_pagar e
      WHERE e.company_id = p_company_id AND e.descricao = n.descricao AND e.valor = n.valor
        AND e.data_vencimento = n.data_vencimento AND e.id <> n.id
        AND e.deleted_at IS NULL AND lower(COALESCE(e.status,'')) NOT IN ('cancelado')
      ORDER BY e.created_at LIMIT 1
    ) sim ON true
    WHERE n.id = ANY(v_ids);
  END IF;
  RETURN jsonb_build_object('success', true, 'qtd_parcelas_criadas', p_total_parcelas,
    'valor_por_parcela', v_valor_parcela, 'ids', to_jsonb(v_ids));
END; $function$;

REVOKE ALL ON FUNCTION public.fn_pagar_criar_com_parcelas(uuid,uuid,text,text,numeric,date,date,integer,text,text,text,text,integer,text,boolean) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_pagar_criar_com_parcelas(uuid,uuid,text,text,numeric,date,date,integer,text,text,text,text,integer,text,boolean) TO authenticated, service_role;

-- receber v1: mesma assinatura (já tem p_forcar_dup) — só acrescenta a auditoria quando forçado.
CREATE OR REPLACE FUNCTION public.fn_receber_criar_com_parcelas(
  p_company_id uuid, p_cliente_id uuid, p_cliente_nome text, p_descricao text, p_valor_total numeric,
  p_data_emissao date, p_data_primeiro_recebimento date, p_total_parcelas integer DEFAULT 1, p_categoria text DEFAULT NULL::text,
  p_numero_documento text DEFAULT NULL::text, p_forma_recebimento text DEFAULT NULL::text, p_observacao text DEFAULT NULL::text,
  p_intervalo_dias integer DEFAULT 30, p_status_inicial text DEFAULT 'aberto'::text, p_conta_bancaria text DEFAULT NULL::text,
  p_forcar_dup boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  IF p_forcar_dup THEN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_novo, created_at)
    SELECT p_company_id, auth.uid(), NULLIF((current_setting('request.jwt.claims', true))::jsonb->>'email',''),
           'erp_receber', n.id::text, 'CRIOU',
           jsonb_build_object('motivo','duplicidade confirmada pelo usuário','titulo_similar_id', sim.id,
                              'descricao', n.descricao, 'valor', n.valor, 'data_vencimento', n.data_vencimento), NOW()
    FROM erp_receber n
    JOIN LATERAL (
      SELECT e.id FROM erp_receber e
      WHERE e.company_id = p_company_id AND e.descricao = n.descricao AND e.valor = n.valor
        AND e.data_vencimento = n.data_vencimento AND e.id <> n.id
        AND e.deleted_at IS NULL AND lower(COALESCE(e.status,'')) NOT IN ('cancelado')
      ORDER BY e.created_at LIMIT 1
    ) sim ON true
    WHERE n.id = ANY(v_ids);
  END IF;
  RETURN jsonb_build_object('success', true, 'qtd_parcelas_criadas', p_total_parcelas,
    'valor_por_parcela', v_valor_parcela, 'status_inicial', v_status, 'ids', to_jsonb(v_ids));
END; $function$;

REVOKE ALL ON FUNCTION public.fn_receber_criar_com_parcelas(uuid,uuid,text,text,numeric,date,date,integer,text,text,text,text,integer,text,text,boolean) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_receber_criar_com_parcelas(uuid,uuid,text,text,numeric,date,date,integer,text,text,text,text,integer,text,text,boolean) TO authenticated, service_role;
