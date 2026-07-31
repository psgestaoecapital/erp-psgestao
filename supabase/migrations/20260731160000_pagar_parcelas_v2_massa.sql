-- RD-41 · Despesas a Pagar — parcelas explícitas (data+valor por parcela) + ações em massa.
-- Aditivo: a fn_pagar_criar_com_parcelas v1 é preservada. As RPCs em massa REUSAM as
-- unitárias (fn_pagar_editar_completo / fn_pagar_excluir) — herdam RLS (get_user_company_ids),
-- autoria (auth.uid), soft-delete, bloqueio pago/conciliado e o log (erp_lancamento_log). RD-57.

-- 1/3 · Criação com parcelas EXPLÍCITAS (data + valor por parcela; permite valor variável)
CREATE OR REPLACE FUNCTION public.fn_pagar_criar_com_parcelas_v2(
  p_company_id     uuid,
  p_fornecedor_id  uuid,
  p_fornecedor_nome text,
  p_descricao      text,
  p_data_emissao   date,
  p_categoria      text DEFAULT NULL,
  p_numero_documento text DEFAULT NULL,
  p_forma_pagamento  text DEFAULT NULL,
  p_observacao     text DEFAULT NULL,
  p_conta_bancaria text DEFAULT NULL,
  p_parcelas       jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
  IF v_total < 1 THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_parcelas'); END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_parcelas) LOOP
    i := i + 1;
    IF NULLIF(r->>'valor','') IS NULL OR NULLIF(r->>'data_vencimento','') IS NULL THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'parcela_incompleta', 'indice', i);
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
GRANT EXECUTE ON FUNCTION public.fn_pagar_criar_com_parcelas_v2(
  uuid,uuid,text,text,date,text,text,text,text,text,jsonb) TO authenticated;

-- 2/3 · Edição em MASSA (reusa fn_pagar_editar_completo → herda RLS + log)
CREATE OR REPLACE FUNCTION public.fn_pagar_editar_massa(p_ids uuid[], p_campos jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_id uuid; v_res jsonb; v_ok int := 0; v_erros jsonb := '[]'::jsonb;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids,1) IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_ids'); END IF;

  FOREACH v_id IN ARRAY p_ids LOOP
    v_res := public.fn_pagar_editar_completo(v_id, p_campos);
    IF (v_res->>'sucesso')::boolean IS TRUE THEN v_ok := v_ok + 1;
    ELSE v_erros := v_erros || jsonb_build_object('id', v_id, 'erro', v_res->>'erro'); END IF;
  END LOOP;

  RETURN jsonb_build_object('sucesso', true, 'alterados', v_ok,
    'falhas', jsonb_array_length(v_erros), 'detalhe_falhas', v_erros);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_pagar_editar_massa(uuid[], jsonb) TO authenticated;

-- 3/3 · Exclusão em MASSA (reusa fn_pagar_excluir → soft-delete + bloqueio pago/conciliado + log)
CREATE OR REPLACE FUNCTION public.fn_pagar_excluir_massa(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_id uuid; v_res jsonb;
        v_ok int := 0; v_bloq int := 0; v_ja int := 0; v_erros jsonb := '[]'::jsonb;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids,1) IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_ids'); END IF;

  FOREACH v_id IN ARRAY p_ids LOOP
    v_res := public.fn_pagar_excluir(v_id);
    IF (v_res->>'sucesso')::boolean IS TRUE AND COALESCE((v_res->>'ja_excluido')::boolean, false)
      THEN v_ja := v_ja + 1;
    ELSIF (v_res->>'sucesso')::boolean IS TRUE
      THEN v_ok := v_ok + 1;
    ELSIF v_res->>'erro' = 'bloqueado_conciliado_ou_pago'
      THEN v_bloq := v_bloq + 1;
    ELSE v_erros := v_erros || jsonb_build_object('id', v_id, 'erro', v_res->>'erro');
    END IF;
  END LOOP;

  RETURN jsonb_build_object('sucesso', true,
    'excluidos', v_ok,
    'ignoradas_pago_conciliado', v_bloq,
    'ja_excluidas', v_ja,
    'outras_falhas', jsonb_array_length(v_erros),
    'detalhe', v_erros);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_pagar_excluir_massa(uuid[]) TO authenticated;
