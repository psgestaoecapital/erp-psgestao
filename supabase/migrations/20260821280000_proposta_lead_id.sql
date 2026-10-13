-- P&M/Comercial · vínculo lead ↔ proposta (o botão "Proposta" do card abre/cria a proposta do lead).
-- Premissa (RD-38/RD-51): o elo não existia — agency_propostas não tinha lead_id. Cria o elo primeiro.
-- RD-26: reusa fn_agency_proposta_criar (via wrapper) em vez de reescrever a função grande.

ALTER TABLE public.agency_propostas ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.agency_leads(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS agency_propostas_lead_idx ON public.agency_propostas (lead_id) WHERE lead_id IS NOT NULL;

-- Proposta vinculada ao lead (a mais recente) — ou null pra a UI decidir criar.
CREATE OR REPLACE FUNCTION public.fn_agency_lead_proposta(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_p record;
BEGIN
  SELECT company_id INTO v_company FROM agency_leads WHERE id = p_lead_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'lead_nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT id, numero, titulo, status, valor_final INTO v_p
    FROM agency_propostas WHERE lead_id = p_lead_id ORDER BY created_at DESC LIMIT 1;
  IF v_p.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'proposta', NULL,
      'total', (SELECT count(*) FROM agency_propostas WHERE lead_id = p_lead_id)); END IF;

  RETURN jsonb_build_object('ok', true,
    'proposta', jsonb_build_object('id', v_p.id, 'numero', v_p.numero, 'titulo', v_p.titulo, 'status', v_p.status, 'valor_final', v_p.valor_final),
    'total', (SELECT count(*) FROM agency_propostas WHERE lead_id = p_lead_id));
END;
$function$;

-- Criar proposta JÁ vinculada ao lead (nunca órfã), pré-preenchida com dados do lead. Wrapper sobre
-- fn_agency_proposta_criar (RD-26) + grava o lead_id. Atômico e gateado.
CREATE OR REPLACE FUNCTION public.fn_agency_lead_proposta_criar(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_lead record; v_res jsonb; v_id uuid;
BEGIN
  SELECT * INTO v_lead FROM agency_leads WHERE id = p_lead_id;
  IF v_lead.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'lead_nao_encontrado'); END IF;
  IF NOT (v_lead.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  v_res := fn_agency_proposta_criar(jsonb_build_object(
    'company_id', v_lead.company_id,
    'titulo', 'Proposta · ' || COALESCE(NULLIF(btrim(v_lead.empresa), ''), NULLIF(btrim(v_lead.nome), ''), 'lead'),
    'erp_cliente_id', v_lead.erp_cliente_id,
    'valor_total', COALESCE(v_lead.valor_estimado, 0),
    'responsavel_id', v_lead.responsavel_id
  ));
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', COALESCE(v_res->>'erro', 'falha_ao_criar')); END IF;

  v_id := NULLIF(v_res->>'id', '')::uuid;
  UPDATE agency_propostas SET lead_id = p_lead_id, updated_at = now() WHERE id = v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'criada', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_agency_lead_proposta(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_agency_lead_proposta_criar(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_lead_proposta(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agency_lead_proposta_criar(uuid) TO authenticated;
