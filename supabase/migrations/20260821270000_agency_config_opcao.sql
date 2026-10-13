-- P&M/Serviços · campos de lista gerenciáveis (select + CRUD). Mesmo padrão do agency_lead_origem
-- (RD-26/52). Uma tabela serve N listas.
--
-- Premissa corrigida (RD-51): o SPEC diz "Tipo, Área, Modelo, Unidade, Periodicidade = texto livre".
-- No form REAL, Tipo e Modelo JÁ são selects (com enum fixo) — e Tipo BRANCHEIA o form (recorrente →
-- periodicidade; pacote → itens do pacote). O texto livre de verdade (a dor "mensal/Mensal/mês") é
-- ÁREA/EQUIPE, UNIDADE e PERIODICIDADE. Então torno essas 3 configuráveis agora; Tipo fica como enum
-- (não quebrar o branching) e Modelo fica no select existente. A tabela serve qualquer lista — dá pra
-- ligar Modelo/Tipo depois se o CEO quiser (1 seed + 1 troca no form).

CREATE TABLE IF NOT EXISTS public.agency_config_opcao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lista text NOT NULL,          -- area_equipe | unidade | periodicidade | (extensível)
  valor text NOT NULL,          -- slug estável (gravado no serviço)
  rotulo text NOT NULL,         -- rótulo editável
  ordem int NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agency_config_opcao_uk ON public.agency_config_opcao (company_id, lista, valor);

ALTER TABLE public.agency_config_opcao ENABLE ROW LEVEL SECURITY;
DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.agency_config_opcao'::regclass AND polname='agency_config_opcao_rls') THEN
    CREATE POLICY agency_config_opcao_rls ON public.agency_config_opcao
      USING (company_id IN (SELECT get_user_company_ids()))
      WITH CHECK (company_id IN (SELECT get_user_company_ids()));
  END IF;
END
$mig$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_config_opcao TO authenticated;

-- defaults por lista (usado no seed do deploy E no auto-seed lazy da RPC de listagem).
CREATE OR REPLACE FUNCTION public.fn_agency_config_defaults(p_lista text)
RETURNS TABLE(valor text, rotulo text, ordem int)
LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT v, r, o FROM (VALUES
    ('area_equipe','social','Social',10),('area_equipe','trafego','Tráfego',20),('area_equipe','criacao','Criação',30),
    ('area_equipe','audiovisual','Audiovisual',40),('area_equipe','estrategia','Estratégia',50),
    ('unidade','mes','mês',10),('unidade','projeto','projeto',20),('unidade','hora','hora',30),
    ('unidade','post','post',40),('unidade','campanha','campanha',50),('unidade','unidade','unidade',60),
    ('periodicidade','mensal','mensal',10),('periodicidade','quinzenal','quinzenal',20),('periodicidade','semanal','semanal',30),
    ('periodicidade','unico','único',40),('periodicidade','sob_demanda','sob demanda',50)
  ) AS d(l,v,r,o) WHERE d.l = p_lista;
$function$;

-- Listar (auto-seed lazy dos defaults da lista na 1ª leitura da empresa).
CREATE OR REPLACE FUNCTION public.fn_agency_config_listar(p_company_id uuid, p_lista text)
RETURNS TABLE(id uuid, valor text, rotulo text, ordem int, ativo boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN RAISE EXCEPTION 'sem_acesso'; END IF;
  IF NOT EXISTS (SELECT 1 FROM agency_config_opcao o WHERE o.company_id = p_company_id AND o.lista = p_lista) THEN
    INSERT INTO agency_config_opcao (company_id, lista, valor, rotulo, ordem)
    SELECT p_company_id, p_lista, d.valor, d.rotulo, d.ordem FROM fn_agency_config_defaults(p_lista) d
    ON CONFLICT (company_id, lista, valor) DO NOTHING;
  END IF;
  RETURN QUERY
    SELECT o.id, o.valor, o.rotulo, o.ordem, o.ativo FROM agency_config_opcao o
     WHERE o.company_id = p_company_id AND o.lista = p_lista AND o.ativo = true
     ORDER BY o.ordem, o.rotulo;
END;
$function$;

-- Salvar (criar: gera slug do rótulo, dedup; editar por id: rótulo/ordem/ativo). Gated à empresa.
CREATE OR REPLACE FUNCTION public.fn_agency_config_salvar(p_campos jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := NULLIF(btrim(p_campos->>'id'), '')::uuid;
  v_company uuid := NULLIF(btrim(p_campos->>'company_id'), '')::uuid;
  v_lista text := NULLIF(btrim(p_campos->>'lista'), '');
  v_rotulo text := NULLIF(btrim(p_campos->>'rotulo'), '');
  v_ordem int := COALESCE(NULLIF(p_campos->>'ordem','')::int, 0);
  v_ativo boolean := COALESCE((p_campos->>'ativo')::boolean, true);
  v_slug text; v_base text; v_i int := 1; v_row agency_config_opcao%ROWTYPE;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_row FROM agency_config_opcao WHERE id = v_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'opcao não encontrada'); END IF;
    IF NOT is_admin() AND v_row.company_id NOT IN (SELECT get_user_company_ids()) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
    UPDATE agency_config_opcao SET rotulo = COALESCE(v_rotulo, rotulo), ordem = v_ordem, ativo = v_ativo WHERE id = v_id;
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'valor', v_row.valor);
  END IF;

  IF v_company IS NULL OR v_lista IS NULL OR v_rotulo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'company_id, lista e rotulo obrigatórios'); END IF;
  IF NOT is_admin() AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;

  v_slug := lower(v_rotulo);
  v_slug := translate(v_slug, 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn');
  v_slug := regexp_replace(v_slug, '[^a-z0-9]+', '_', 'g');
  v_slug := btrim(v_slug, '_');
  IF v_slug = '' THEN v_slug := 'opcao'; END IF;
  v_base := v_slug;
  WHILE EXISTS (SELECT 1 FROM agency_config_opcao WHERE company_id = v_company AND lista = v_lista AND valor = v_slug) LOOP
    v_i := v_i + 1; v_slug := v_base || '_' || v_i;
  END LOOP;

  INSERT INTO agency_config_opcao (company_id, lista, valor, rotulo, ordem, ativo)
  VALUES (v_company, v_lista, v_slug, v_rotulo, v_ordem, v_ativo)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'valor', v_slug);
END;
$function$;

-- Excluir (bloqueia se a opção está em uso por algum serviço — RD-54). Mapeia lista → coluna do serviço.
CREATE OR REPLACE FUNCTION public.fn_agency_config_excluir(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_row agency_config_opcao%ROWTYPE; v_qtd int := 0; v_col text;
BEGIN
  SELECT * INTO v_row FROM agency_config_opcao WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'opcao não encontrada'); END IF;
  IF NOT is_admin() AND v_row.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;

  v_col := CASE v_row.lista WHEN 'area_equipe' THEN 'area' WHEN 'unidade' THEN 'unidade' WHEN 'periodicidade' THEN 'periodicidade' ELSE NULL END;
  IF v_col IS NOT NULL THEN
    EXECUTE format('SELECT count(*) FROM agency_servico WHERE company_id = $1 AND %I = $2', v_col)
      INTO v_qtd USING v_row.company_id, v_row.valor;
    IF v_qtd > 0 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'opcao_em_uso', 'qtd', v_qtd); END IF;
  END IF;

  DELETE FROM agency_config_opcao WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_agency_config_listar(uuid,text) FROM anon;
REVOKE ALL ON FUNCTION public.fn_agency_config_salvar(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.fn_agency_config_excluir(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_config_listar(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agency_config_salvar(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agency_config_excluir(uuid) TO authenticated;

-- Seed no deploy (não-lazy) pras empresas que já usam o comercial (têm lead) — cobre a PDois.
INSERT INTO public.agency_config_opcao (company_id, lista, valor, rotulo, ordem)
SELECT c.company_id, l.lista, d.valor, d.rotulo, d.ordem
FROM (SELECT DISTINCT company_id FROM public.agency_leads) c
CROSS JOIN (VALUES ('area_equipe'),('unidade'),('periodicidade')) AS l(lista)
CROSS JOIN LATERAL public.fn_agency_config_defaults(l.lista) d
ON CONFLICT (company_id, lista, valor) DO NOTHING;
