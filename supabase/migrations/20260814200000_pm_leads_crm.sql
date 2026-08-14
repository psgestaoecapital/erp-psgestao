-- P&M · Leads/CRM — captura de contato + cadastro rápido (aditivo). Origem: CEO 14/08.
-- Só ADD COLUMN + nova RPC. Reusa fn_cliente_buscar / fn_crm_converter_lead / fn_agency_lead_ganhar.

ALTER TABLE public.agency_leads
  ADD COLUMN IF NOT EXISTS contato_email text,
  ADD COLUMN IF NOT EXISTS contato_telefone text;

-- Cadastro rápido do lead: valida acesso à empresa e insere. Se vier cliente_id, o front já herda os
-- dados do cliente (empresa/nome/email/telefone) antes de chamar; aqui só grava o que veio.
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
  v_id uuid;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'company_id obrigatorio';
  END IF;
  -- get_user_company_ids() é SETOF uuid → usar IN (SELECT ...), não = ANY(...)
  IF NOT is_admin() AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RAISE EXCEPTION 'sem_acesso';
  END IF;
  -- nome é NOT NULL sem default: cai p/ a empresa; se ambos vazios, erro claro (RD-58, não falha cru).
  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'informe ao menos a empresa ou o contato do lead';
  END IF;

  INSERT INTO agency_leads (
    company_id, empresa, nome, contato_email, contato_telefone,
    origem, canal_contato, etapa, valor_estimado, responsavel_id, cliente_id, observacoes)
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
    NULLIF(btrim(p_campos->>'cliente_id'), '')::uuid,
    NULLIF(btrim(p_campos->>'observacoes'), ''))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_agency_lead_criar(jsonb) TO authenticated;
