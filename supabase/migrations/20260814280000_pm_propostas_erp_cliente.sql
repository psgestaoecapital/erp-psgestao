-- P&M · unificar cliente das Propostas em erp_clientes (fecha opção A). Origem: Eng. Chefe 14/08.
-- Regra-mãe (b9333675): todo picker busca erp_clientes (base mestre); um helper resolve/cria o
-- agency_cliente correspondente. Nunca gravar id de erp_clientes numa FK que aponta pra agency_clientes.
-- Pré-requisito do Contrato: Lead → Proposta → Contrato casam pelo mesmo cliente (erp_cliente_id).
-- 100% aditivo (RD-30/RD-54): ADD COLUMN/INDEX/FUNCTION + backfill que só preenche nulos.
-- Auditado (RD-26): erp_clientes NÃO tem coluna `nome` (só nome_fantasia/razao_social);
-- agency_clientes.nome é NOT NULL → COALESCE com fallback não-nulo.

-- 1.1 Helper de resolução (idempotente): erp_cliente → agency_cliente (cria se faltar).
CREATE OR REPLACE FUNCTION public.fn_agency_cliente_resolver(p_company_id uuid, p_erp_cliente_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_agency_id uuid;
BEGIN
  IF p_company_id IS NULL OR p_erp_cliente_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RAISE EXCEPTION 'sem_acesso';
  END IF;

  SELECT id INTO v_agency_id
  FROM agency_clientes
  WHERE company_id = p_company_id AND erp_cliente_id = p_erp_cliente_id
  LIMIT 1;

  IF v_agency_id IS NULL THEN
    INSERT INTO agency_clientes (company_id, erp_cliente_id, nome)
    SELECT p_company_id, p_erp_cliente_id,
           COALESCE(NULLIF(btrim(ec.nome_fantasia), ''), NULLIF(btrim(ec.razao_social), ''), 'Cliente')
    FROM erp_clientes ec
    WHERE ec.id = p_erp_cliente_id
    RETURNING id INTO v_agency_id;
  END IF;

  RETURN v_agency_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_agency_cliente_resolver(uuid, uuid) TO authenticated;

-- 1.2 Coluna de vínculo mestre em Propostas.
ALTER TABLE public.agency_propostas
  ADD COLUMN IF NOT EXISTS erp_cliente_id uuid REFERENCES public.erp_clientes(id);
CREATE INDEX IF NOT EXISTS idx_agency_propostas_erp_cliente
  ON public.agency_propostas(erp_cliente_id);

-- 1.3 fn_agency_proposta_criar aceita p_erp_cliente_id, resolve o agency_cliente e grava OS DOIS.
CREATE OR REPLACE FUNCTION public.fn_agency_proposta_criar(p_campos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := NULLIF(p_campos->>'company_id','')::uuid;
  v_cliente uuid := NULLIF(p_campos->>'cliente_id','')::uuid;     -- agency_clientes (legado/direto)
  v_erp uuid := NULLIF(p_campos->>'erp_cliente_id','')::uuid;     -- erp_clientes (base mestre)
  v_briefing uuid := NULLIF(p_campos->>'briefing_id','')::uuid;
  v_titulo text := NULLIF(btrim(COALESCE(p_campos->>'titulo','')),'');
  v_itens jsonb := COALESCE(p_campos->'itens','[]'::jsonb);
  v_desconto numeric := COALESCE(NULLIF(p_campos->>'desconto','')::numeric, 0);
  v_total numeric;
  v_final numeric;
  v_id uuid;
BEGIN
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'company_id obrigatório');
  END IF;
  IF NOT is_admin() AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso à empresa');
  END IF;
  IF v_titulo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'título obrigatório');
  END IF;

  -- Cliente: se veio erp_cliente_id (base mestre), resolve/cria o agency_cliente e grava os dois.
  IF v_erp IS NOT NULL THEN
    v_cliente := fn_agency_cliente_resolver(v_company, v_erp);
  END IF;

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
    company_id, cliente_id, erp_cliente_id, briefing_id, titulo, descricao, itens,
    valor_total, desconto, valor_final, condicao_pagamento,
    prazo_execucao, validade_proposta, responsavel_id, observacoes, status
  ) VALUES (
    v_company, v_cliente, v_erp, v_briefing, v_titulo,
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

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'cliente_id', v_cliente, 'erp_cliente_id', v_erp,
                            'valor_total', v_total, 'valor_final', v_final);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_agency_proposta_criar(jsonb) TO authenticated;

-- 1.4 Backfill aditivo (RD-54): preenche erp_cliente_id das propostas a partir do vínculo já
-- existente em agency_clientes.erp_cliente_id. Só preenche nulos; nunca apaga; nunca toca proposta
-- sem cliente resolvido.
UPDATE public.agency_propostas p
SET erp_cliente_id = ac.erp_cliente_id
FROM public.agency_clientes ac
WHERE p.cliente_id = ac.id
  AND ac.erp_cliente_id IS NOT NULL
  AND p.erp_cliente_id IS NULL;
