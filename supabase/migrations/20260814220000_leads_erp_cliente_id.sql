-- FIX P&M Leads · FK cliente_id (erp_clientes × agency_clientes). Origem: Eng. Chefe 14/08.
-- Bug prod (#1007): autocomplete usa fn_cliente_buscar/fn_cliente_criar_inline (cadastro GE →
-- erp_clientes), mas o modal gravava esse id em agency_leads.cliente_id, cuja FK aponta para
-- agency_clientes → "insert violates agency_leads_cliente_id_fkey". Correção (aditiva, RD-30):
-- novo elo erp_cliente_id → erp_clientes (mesmo padrão da Fase 0 em agency_clientes.erp_cliente_id).
-- cliente_id fica reservado para vínculo a um cliente FORMAL da agência (agency_clientes).

-- 1) Elo do lead ao cadastro GE
ALTER TABLE public.agency_leads
  ADD COLUMN IF NOT EXISTS erp_cliente_id uuid REFERENCES public.erp_clientes(id);

-- 2) Conserta vínculos gravados errado: cliente_id que não é agency_cliente mas é erp_cliente → move
UPDATE public.agency_leads l
SET erp_cliente_id = l.cliente_id, cliente_id = NULL
WHERE l.cliente_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.agency_clientes ac WHERE ac.id = l.cliente_id)
  AND EXISTS (SELECT 1 FROM public.erp_clientes ec WHERE ec.id = l.cliente_id);

-- 3) fn_agency_lead_criar passa a mapear erp_cliente_id (GE) e só grava cliente_id se for agency_cliente.
CREATE OR REPLACE FUNCTION public.fn_agency_lead_criar(p_campos jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := NULLIF(btrim(p_campos->>'company_id'), '')::uuid;
  v_empresa text := NULLIF(btrim(p_campos->>'empresa'), '');
  v_nome    text := COALESCE(NULLIF(btrim(p_campos->>'nome'), ''), NULLIF(btrim(p_campos->>'empresa'), ''));
  v_erp_cli uuid := NULLIF(btrim(p_campos->>'erp_cliente_id'), '')::uuid;
  v_agc_cli uuid := NULLIF(btrim(p_campos->>'cliente_id'), '')::uuid;
  v_id uuid;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'company_id obrigatorio';
  END IF;
  -- get_user_company_ids() é SETOF uuid → usar IN (SELECT ...), não = ANY(...)
  IF NOT is_admin() AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RAISE EXCEPTION 'sem_acesso';
  END IF;
  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'informe ao menos a empresa ou o contato do lead';
  END IF;
  -- Blindagem: se veio um id em cliente_id que na verdade é erp_cliente, redireciona (evita a FK).
  IF v_agc_cli IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM agency_clientes ac WHERE ac.id = v_agc_cli)
     AND EXISTS (SELECT 1 FROM erp_clientes ec WHERE ec.id = v_agc_cli) THEN
    v_erp_cli := COALESCE(v_erp_cli, v_agc_cli);
    v_agc_cli := NULL;
  END IF;

  INSERT INTO agency_leads (
    company_id, empresa, nome, contato_email, contato_telefone,
    origem, canal_contato, etapa, valor_estimado, responsavel_id,
    cliente_id, erp_cliente_id, observacoes)
  VALUES (
    v_company,
    v_empresa,
    v_nome,
    NULLIF(btrim(p_campos->>'contato_email'), ''),
    NULLIF(btrim(p_campos->>'contato_telefone'), ''),
    COALESCE(NULLIF(btrim(p_campos->>'origem'), ''), 'relacionamento'),  -- origem NOT NULL + CHECK → default válido
    NULLIF(btrim(p_campos->>'canal_contato'), ''),
    COALESCE(NULLIF(btrim(p_campos->>'etapa'), ''), 'novo'),
    NULLIF(p_campos->>'valor_estimado', '')::numeric,
    NULLIF(btrim(p_campos->>'responsavel_id'), '')::uuid,
    v_agc_cli,
    v_erp_cli,
    NULLIF(btrim(p_campos->>'observacoes'), ''))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_agency_lead_criar(jsonb) TO authenticated;
