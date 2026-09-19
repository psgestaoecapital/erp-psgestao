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

-- ── fn_import_financeiro_v3 (importador; p_company_id → guarda padrão + blindagem do override por linha) ─
-- Grupo A do Lote 1c (SPEC do Eng. Chefe 19/09). Escreve erp_pagar/erp_receber (categoria/centro_custo,
-- colunas existentes — funciona). Guarda pela empresa do parâmetro E rejeita registros cujo company_id
-- (override por linha) aponte p/ empresa fora do acesso do authenticated (fecha o vazamento multiempresa).
-- Corpo reproduzido fiel de produção; só a guarda foi acrescentada.
CREATE OR REPLACE FUNCTION public.fn_import_financeiro_v3(p_company_id uuid, p_user_id uuid, p_arquivo_nome text, p_records jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_importacao_id uuid; v_record jsonb;
  v_inseridos int := 0; v_duplicados int := 0; v_erros int := 0;
  v_lista_erros jsonb := '[]'::jsonb;
  v_company_id uuid; v_tipo text; v_status text;
  v_total int; v_idx int := 0; v_ref_id text; v_new_id uuid;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  -- guarda padrão (empresa do parâmetro)
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
  -- BUG 2: aceita {"records": [...]} além do array puro
  IF jsonb_typeof(p_records) = 'object' AND p_records ? 'records' THEN
    p_records := p_records -> 'records';
  END IF;
  IF jsonb_typeof(p_records) <> 'array' THEN
    RETURN jsonb_build_object('erro', 'payload_invalido',
      'detalhe', 'Esperado um array de registros (ou objeto {"records": [...]}).');
  END IF;
  -- blindagem: nenhum registro pode direcionar escrita a empresa fora do acesso (override company_id por linha)
  IF NOT (v_interno OR auth.role()='service_role' OR is_admin()) AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_records) r
    WHERE NULLIF(r->>'company_id','') IS NOT NULL
      AND (r->>'company_id')::uuid NOT IN (SELECT get_user_company_ids())
  ) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;

  v_total := jsonb_array_length(p_records);
  INSERT INTO erp_importacoes (company_id, user_id, sistema_origem, tipo_dado, registros_total, status, arquivo_nome, iniciado_em)
  VALUES (p_company_id, p_user_id, 'planilha_padrao', 'financeiro', v_total, 'processando', p_arquivo_nome, NOW())
  RETURNING id INTO v_importacao_id;

  FOR v_record IN SELECT * FROM jsonb_array_elements(p_records) LOOP
    v_idx := v_idx + 1;
    BEGIN
      v_company_id := COALESCE(NULLIF(v_record->>'company_id','')::uuid, p_company_id);
      v_tipo := LOWER(TRIM(v_record->>'tipo'));
      IF v_tipo NOT IN ('pagar','receber') THEN
        RAISE EXCEPTION 'tipo deve ser pagar ou receber (recebido: %)', v_record->>'tipo';
      END IF;
      IF (v_record->>'valor_documento') IS NULL OR (v_record->>'valor_documento')::numeric <= 0 THEN
        RAISE EXCEPTION 'valor_documento obrigatorio e > 0';
      END IF;
      IF NULLIF(v_record->>'data_vencimento','') IS NULL THEN
        RAISE EXCEPTION 'data_vencimento obrigatoria';
      END IF;

      v_status := CASE LOWER(TRIM(COALESCE(v_record->>'status','')))
        WHEN 'pago' THEN 'pago' WHEN 'quitado' THEN 'pago' WHEN 'liquidado' THEN 'pago'
        WHEN 'parcial' THEN 'parcial'
        WHEN 'vencido' THEN 'vencido' WHEN 'atrasado' THEN 'vencido'
        WHEN 'cancelado' THEN 'cancelado'
        ELSE 'aberto' END;

      v_ref_id := COALESCE(NULLIF(v_record->>'import_hash',''),
        md5(v_company_id::text||v_tipo||(v_record->>'valor_documento')||(v_record->>'data_vencimento')||COALESCE(v_record->>'descricao','')));

      IF v_tipo = 'pagar' THEN
        INSERT INTO erp_pagar (company_id, descricao, valor, valor_pago, data_emissao, data_vencimento,
          data_pagamento, data_competencia, status, categoria, centro_custo, forma_pagamento, fornecedor_nome,
          import_hash, ref_externa_sistema, ref_externa_id, importado_em, created_at, updated_at)
        VALUES (v_company_id,
          COALESCE(NULLIF(TRIM(v_record->>'descricao'),''),'Lancamento importado'),
          (v_record->>'valor_documento')::numeric, NULLIF(v_record->>'valor_pago','')::numeric,
          NULLIF(v_record->>'data_emissao','')::date, (v_record->>'data_vencimento')::date,
          NULLIF(v_record->>'data_pagamento','')::date,
          COALESCE(NULLIF(v_record->>'data_emissao','')::date, (v_record->>'data_vencimento')::date),
          v_status, NULLIF(v_record->>'categoria',''), NULLIF(v_record->>'centro_custo',''),
          NULLIF(v_record->>'forma_pagamento',''), NULLIF(v_record->>'nome_pessoa',''),
          NULLIF(v_record->>'import_hash',''), 'importacao_planilha', v_ref_id, NOW(), NOW(), NOW())
        ON CONFLICT (company_id, ref_externa_sistema, ref_externa_id) WHERE ref_externa_id IS NOT NULL DO NOTHING
        RETURNING id INTO v_new_id;
      ELSE
        INSERT INTO erp_receber (company_id, descricao, valor, valor_pago, data_emissao, data_vencimento,
          data_pagamento, data_competencia, status, categoria, centro_custo, forma_pagamento, cliente_nome,
          import_hash, ref_externa_sistema, ref_externa_id, importado_em, created_at, updated_at)
        VALUES (v_company_id,
          COALESCE(NULLIF(TRIM(v_record->>'descricao'),''),'Lancamento importado'),
          (v_record->>'valor_documento')::numeric, NULLIF(v_record->>'valor_pago','')::numeric,
          NULLIF(v_record->>'data_emissao','')::date, (v_record->>'data_vencimento')::date,
          NULLIF(v_record->>'data_pagamento','')::date,
          COALESCE(NULLIF(v_record->>'data_emissao','')::date, (v_record->>'data_vencimento')::date),
          v_status, NULLIF(v_record->>'categoria',''), NULLIF(v_record->>'centro_custo',''),
          NULLIF(v_record->>'forma_pagamento',''), NULLIF(v_record->>'nome_pessoa',''),
          NULLIF(v_record->>'import_hash',''), 'importacao_planilha', v_ref_id, NOW(), NOW(), NOW())
        ON CONFLICT (company_id, ref_externa_sistema, ref_externa_id) WHERE ref_externa_id IS NOT NULL DO NOTHING
        RETURNING id INTO v_new_id;
      END IF;

      IF v_new_id IS NULL THEN v_duplicados := v_duplicados + 1; ELSE v_inseridos := v_inseridos + 1; END IF;
      v_new_id := NULL;
    EXCEPTION WHEN OTHERS THEN
      v_erros := v_erros + 1;
      v_lista_erros := v_lista_erros || jsonb_build_object('linha', v_idx, 'descricao', v_record->>'descricao', 'erro', SQLERRM);
    END;
  END LOOP;

  UPDATE erp_importacoes SET registros_novos=v_inseridos, registros_atualizados=v_duplicados, registros_erro=v_erros,
    erros = CASE WHEN v_erros>0 THEN v_lista_erros ELSE NULL END,
    status = CASE WHEN v_erros>0 AND v_inseridos=0 THEN 'falhou' WHEN v_erros>0 THEN 'parcial' ELSE 'concluido' END,
    concluido_em = NOW()
  WHERE id = v_importacao_id;

  RETURN jsonb_build_object('importacao_id', v_importacao_id, 'total', v_total,
    'inseridos', v_inseridos, 'duplicados', v_duplicados, 'erros', v_erros, 'lista_erros', v_lista_erros,
    'status', CASE WHEN v_erros>0 AND v_inseridos=0 THEN 'falhou' WHEN v_erros>0 THEN 'parcial' ELSE 'concluido' END);
END;
$function$;

-- NOTA (Grupo A): fn_importar_planilha_lote NÃO entra aqui. Ela escreve em
-- erp_pagar/erp_receber.plano_contas_codigo — coluna INEXISTENTE (só há 'categoria'/'centro_custo'),
-- então está 100% quebrada em produção (todo registro cai no EXCEPTION e vira erro). É o MESMO defeito de
-- fn_orcamento_criar_venda. "Reproduzir fiel + só a guarda" numa função morta não protege nada; ela é
-- corrigida (coluna certa) E blindada (REVOKE anon + guarda) no PR do BUG (item 2 do Eng. Chefe), num só lugar
-- — evita CREATE OR REPLACE duplicado disputando com este PR (ordem de merge não garantida).

-- ── ACL ────────────────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.fn_receber_criar_com_parcelas(uuid,uuid,text,text,numeric,date,date,integer,text,text,text,text,integer,text,text,boolean) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_receber_criar_com_parcelas(uuid,uuid,text,text,numeric,date,date,integer,text,text,text,text,integer,text,text,boolean) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_pagar_criar_com_parcelas(uuid,uuid,text,text,numeric,date,date,integer,text,text,text,text,integer,text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_pagar_criar_com_parcelas(uuid,uuid,text,text,numeric,date,date,integer,text,text,text,text,integer,text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_veic__receber(uuid,uuid,text,numeric,date,uuid,text,text,uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_veic__receber(uuid,uuid,text,numeric,date,uuid,text,text,uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_import_financeiro_v3(uuid,uuid,text,jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_import_financeiro_v3(uuid,uuid,text,jsonb) TO authenticated, service_role;
