-- BUG · P&M/Kanban: leads novos somem. fn_agency_lead_criar gravava etapa='novo', mas o Kanban usa a
-- coluna 'novo_atendimento' (do funil_etapa). Os leads em 'novo' ficam invisíveis.
--
-- Premissa corrigida (RD-51): as etapas do funil são CONFIGURÁVEIS por empresa (funil_etapa, com slugs
-- custom via fn_funil_etapa_salvar). Um CHECK estático com lista fixa quebraria a configurabilidade e é
-- table-wide (não por empresa). Então: (1) a origem passa a gravar a PRIMEIRA etapa do funil da empresa
-- (dinâmico; fallback 'novo_atendimento'); (2) backfill dos 'novo' → primeira etapa; (3) o guard (RD-58)
-- valida a etapa contra o FUNIL REAL da empresa via trigger — não uma lista chumbada.

-- 1) Origem: default de etapa = primeira etapa do funil da empresa (não mais 'novo' hardcoded).
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
  v_etapa   text := NULLIF(btrim(p_campos->>'etapa'), '');
  v_id uuid;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'company_id obrigatorio';
  END IF;
  IF NOT is_admin() AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RAISE EXCEPTION 'sem_acesso';
  END IF;
  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'informe ao menos a empresa ou o contato do lead';
  END IF;

  -- etapa: se não veio, usa a PRIMEIRA etapa do funil de leads da empresa (dinâmico) → nunca 'novo'.
  IF v_etapa IS NULL THEN
    SELECT chave INTO v_etapa FROM funil_etapa
     WHERE company_id = v_company AND tipo_funil = 'leads' AND ativo
     ORDER BY ordem, rotulo LIMIT 1;
    v_etapa := COALESCE(v_etapa, 'novo_atendimento');
  END IF;

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
    v_company, v_empresa, v_nome,
    NULLIF(btrim(p_campos->>'contato_email'), ''),
    NULLIF(btrim(p_campos->>'contato_telefone'), ''),
    COALESCE(NULLIF(btrim(p_campos->>'origem'), ''), 'relacionamento'),
    NULLIF(btrim(p_campos->>'canal_contato'), ''),
    v_etapa,
    NULLIF(p_campos->>'valor_estimado', '')::numeric,
    NULLIF(btrim(p_campos->>'responsavel_id'), '')::uuid,
    v_agc_cli, v_erp_cli,
    NULLIF(btrim(p_campos->>'observacoes'), ''))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- 2) Backfill: leads em 'novo' → primeira etapa do funil da empresa (fallback 'novo_atendimento').
UPDATE public.agency_leads l SET etapa = COALESCE(
    (SELECT fe.chave FROM funil_etapa fe
      WHERE fe.company_id = l.company_id AND fe.tipo_funil = 'leads' AND fe.ativo
      ORDER BY fe.ordem, fe.rotulo LIMIT 1),
    'novo_atendimento'),
  atualizado_em = now()
WHERE l.etapa = 'novo';

-- 3) Guard (RD-58) sem quebrar a configurabilidade: valida a etapa contra o FUNIL da empresa (não lista
--    fixa). Só valida quando a empresa JÁ tem funil definido (respeita o auto-seed lazy do funil_etapa).
CREATE OR REPLACE FUNCTION public.fn_agency_leads_valida_etapa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.etapa IS NOT NULL
     AND EXISTS (SELECT 1 FROM funil_etapa WHERE company_id = NEW.company_id AND tipo_funil = 'leads')
     AND NOT EXISTS (SELECT 1 FROM funil_etapa WHERE company_id = NEW.company_id AND tipo_funil = 'leads' AND chave = NEW.etapa)
  THEN
    RAISE EXCEPTION 'etapa "%" invalida para o funil de leads desta empresa', NEW.etapa
      USING HINT = 'use uma etapa configurada no funil (funil_etapa)';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_agency_leads_valida_etapa ON public.agency_leads;
CREATE TRIGGER trg_agency_leads_valida_etapa
  BEFORE INSERT OR UPDATE OF etapa ON public.agency_leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_agency_leads_valida_etapa();
