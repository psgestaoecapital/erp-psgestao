-- CRM/P&M · #19b: Origem do lead configurável por empresa. Fronteira CRM.
--
-- Premissa corrigida (RD-38/RD-51): o SPEC citou erp_crm_lead / erp_crm_origem_lead e "base nova,
-- 0 leads". Na verdade os leads vivem em agency_leads (31 leads, origem em texto, 4 slugs já em uso:
-- indicacao, prospeccao_ia_fria, relacionamento, trafego_pago). erp_crm_lead existe mas está vazio e
-- não é usado pela UI. Então a tabela de origens acompanha o módulo real (agency), não erp_crm.
--
-- Padrão espelhado de funil_etapa (RD-26): chave (slug estável) + nome (rótulo editável), RLS por
-- empresa, e um RPC de listagem que AUTO-SEMEIA os defaults na 1ª leitura de cada empresa (sem sujar
-- as 19 empresas que não usam CRM). Os defaults incluem os 4 slugs já existentes, então os 31 leads
-- atuais "casam" e continuam exibindo rótulo (RD-51 — não quebrar o que existe). agency_leads.origem
-- segue texto (sem FK), igual etapa↔funil_etapa.chave.

CREATE TABLE IF NOT EXISTS public.agency_lead_origem (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  chave text NOT NULL,
  nome text NOT NULL,
  ordem int NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agency_lead_origem_company_chave_uk
  ON public.agency_lead_origem (company_id, chave);

ALTER TABLE public.agency_lead_origem ENABLE ROW LEVEL SECURITY;
DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.agency_lead_origem'::regclass AND polname='agency_lead_origem_rls') THEN
    CREATE POLICY agency_lead_origem_rls ON public.agency_lead_origem
      USING (company_id IN (SELECT get_user_company_ids()))
      WITH CHECK (company_id IN (SELECT get_user_company_ids()));
  END IF;
END
$mig$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_lead_origem TO authenticated;

-- Listar (auto-seed lazy dos defaults na 1ª leitura da empresa). Defaults = os 7 do SPEC
-- (WhatsApp/Site/Indicação/Tráfego Pago/Ligação/E-mail/Evento) + os 2 slugs legados restantes
-- (relacionamento, prospeccao_ia_fria) pra os leads existentes casarem.
CREATE OR REPLACE FUNCTION public.fn_agency_origens_listar(p_company_id uuid)
RETURNS TABLE(id uuid, chave text, nome text, ordem int, ativo boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RAISE EXCEPTION 'sem_acesso';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM agency_lead_origem o WHERE o.company_id = p_company_id) THEN
    INSERT INTO agency_lead_origem (company_id, chave, nome, ordem)
    SELECT p_company_id, d.chave, d.nome, d.ordem
    FROM (VALUES
      ('whatsapp','WhatsApp',10),
      ('site','Site',20),
      ('indicacao','Indicação',30),
      ('trafego_pago','Tráfego Pago',40),
      ('ligacao','Ligação',50),
      ('email','E-mail',60),
      ('evento','Evento',70),
      ('relacionamento','Relacionamento',80),
      ('prospeccao_ia_fria','Prospecção IA (fria)',90)
    ) AS d(chave,nome,ordem)
    ON CONFLICT (company_id, chave) DO NOTHING;
  END IF;

  RETURN QUERY
    SELECT o.id, o.chave, o.nome, o.ordem, o.ativo
    FROM agency_lead_origem o
    WHERE o.company_id = p_company_id AND o.ativo = true
    ORDER BY o.ordem, o.nome;
END;
$function$;

-- Salvar (criar: gera slug do nome, dedup; editar: nome/ordem/ativo). Espelha fn_funil_etapa_salvar.
CREATE OR REPLACE FUNCTION public.fn_agency_origem_salvar(p_campos jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := NULLIF(btrim(p_campos->>'id'), '')::uuid;
  v_company uuid := NULLIF(btrim(p_campos->>'company_id'), '')::uuid;
  v_nome text := NULLIF(btrim(p_campos->>'nome'), '');
  v_ordem int := COALESCE(NULLIF(p_campos->>'ordem','')::int, 0);
  v_ativo boolean := COALESCE((p_campos->>'ativo')::boolean, true);
  v_slug text; v_base text; v_i int := 1; v_row agency_lead_origem%ROWTYPE;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_row FROM agency_lead_origem WHERE id = v_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'origem não encontrada'); END IF;
    IF NOT is_admin() AND v_row.company_id NOT IN (SELECT get_user_company_ids()) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
    END IF;
    UPDATE agency_lead_origem SET
      nome = COALESCE(v_nome, nome),
      ordem = v_ordem,
      ativo = v_ativo
    WHERE id = v_id;
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'chave', v_row.chave);
  END IF;

  IF v_company IS NULL OR v_nome IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'company_id e nome obrigatórios');
  END IF;
  IF NOT is_admin() AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;

  v_slug := lower(v_nome);
  v_slug := translate(v_slug, 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn');
  v_slug := regexp_replace(v_slug, '[^a-z0-9]+', '_', 'g');
  v_slug := btrim(v_slug, '_');
  IF v_slug = '' THEN v_slug := 'origem'; END IF;
  v_base := v_slug;
  WHILE EXISTS (SELECT 1 FROM agency_lead_origem WHERE company_id = v_company AND chave = v_slug) LOOP
    v_i := v_i + 1; v_slug := v_base || '_' || v_i;
  END LOOP;

  INSERT INTO agency_lead_origem (company_id, chave, nome, ordem, ativo)
  VALUES (v_company, v_slug, v_nome, v_ordem, v_ativo)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'chave', v_slug);
END;
$function$;

-- Excluir (bloqueia se algum lead usa a origem — igual à guarda de etapa; senão apaga).
CREATE OR REPLACE FUNCTION public.fn_agency_origem_excluir(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_row agency_lead_origem%ROWTYPE; v_qtd int := 0;
BEGIN
  SELECT * INTO v_row FROM agency_lead_origem WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'origem não encontrada'); END IF;
  IF NOT is_admin() AND v_row.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;

  SELECT count(*) INTO v_qtd FROM agency_leads
   WHERE company_id = v_row.company_id AND origem = v_row.chave;
  IF v_qtd > 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'origem_com_leads', 'qtd', v_qtd);
  END IF;

  DELETE FROM agency_lead_origem WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_agency_origens_listar(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_agency_origem_salvar(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.fn_agency_origem_excluir(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_origens_listar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agency_origem_salvar(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agency_origem_excluir(uuid) TO authenticated;
