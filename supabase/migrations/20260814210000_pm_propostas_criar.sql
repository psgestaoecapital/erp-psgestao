-- RD-41 · P&M · Propostas / Orçamentos — backend de criação.
-- SPEC: "Se não existir RPC de criação, adicionar fn_agency_proposta_criar(p_campos jsonb)
-- (valida acesso + insere, aceita itens, cliente_id, briefing_id). Sem novas colunas."
-- Confirmado: a RPC não existia (pg_proc=0). A estrutura de agency_propostas já cobre tudo
-- (itens jsonb, desconto, valor_final). 100% aditivo (RD-30/RD-54): só CREATE FUNCTION + GRANT.
--
-- Modelagem (mesma nuance sinalizada no PR): agency_propostas.cliente_id referencia
-- agency_clientes (não erp_clientes) — é o que fn_agency_proposta_aprovar consome
-- (v_cli agency_clientes%ROWTYPE). Por isso o picker no front é sobre agency_clientes.

CREATE OR REPLACE FUNCTION public.fn_agency_proposta_criar(p_campos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := NULLIF(p_campos->>'company_id','')::uuid;
  v_cliente uuid := NULLIF(p_campos->>'cliente_id','')::uuid;
  v_briefing uuid := NULLIF(p_campos->>'briefing_id','')::uuid;
  v_titulo text := NULLIF(btrim(COALESCE(p_campos->>'titulo','')),'');
  v_itens jsonb := COALESCE(p_campos->'itens','[]'::jsonb);
  v_desconto numeric := COALESCE(NULLIF(p_campos->>'desconto','')::numeric, 0);
  v_total numeric;
  v_final numeric;
  v_id uuid;
BEGIN
  -- Acesso (RD-45): empresa obrigatória e do usuário (ou admin).
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'company_id obrigatório');
  END IF;
  IF NOT is_admin() AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso à empresa');
  END IF;
  IF v_titulo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'título obrigatório');
  END IF;

  -- valor_total: usa o enviado; se ausente, soma os itens (item.valor_total || quantidade*valor_unitario).
  IF (p_campos ? 'valor_total') AND NULLIF(p_campos->>'valor_total','') IS NOT NULL THEN
    v_total := (p_campos->>'valor_total')::numeric;
  ELSE
    SELECT COALESCE(SUM(
             COALESCE(
               NULLIF(it->>'valor_total','')::numeric,
               COALESCE(NULLIF(it->>'quantidade','')::numeric,0) * COALESCE(NULLIF(it->>'valor_unitario','')::numeric,0)
             )
           ), 0)
      INTO v_total
      FROM jsonb_array_elements(v_itens) it;
  END IF;

  v_final := GREATEST(v_total - COALESCE(v_desconto,0), 0);

  INSERT INTO agency_propostas (
    company_id, cliente_id, briefing_id, titulo, descricao, itens,
    valor_total, desconto, valor_final, condicao_pagamento,
    prazo_execucao, validade_proposta, responsavel_id, observacoes, status
  ) VALUES (
    v_company, v_cliente, v_briefing, v_titulo,
    NULLIF(p_campos->>'descricao',''), v_itens,
    v_total, COALESCE(v_desconto,0), v_final,
    NULLIF(p_campos->>'condicao_pagamento',''),
    NULLIF(p_campos->>'prazo_execucao','')::integer,
    NULLIF(p_campos->>'validade_proposta','')::date,
    NULLIF(p_campos->>'responsavel_id','')::uuid,
    NULLIF(p_campos->>'observacoes',''),
    COALESCE(NULLIF(p_campos->>'status',''), 'rascunho')
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'valor_total', v_total, 'valor_final', v_final);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_agency_proposta_criar(jsonb) TO authenticated;
