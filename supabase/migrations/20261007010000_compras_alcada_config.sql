-- #1677 (A) · Fluxo de compras com alçada — CONFIGURAÇÃO da alçada por empresa (núcleo; Gean, FC Pisos, FCR, Tryo).
-- Decisão CEO + equipe 06/10: aprovador geral (principal + substituto), nº mínimo de orçamentos (3 padrão, 1 se a empresa
-- mudar), itens/categorias que liberam compra urgente; e registro de quem aprovou/quando/por quê na compra.
-- ADITIVA: tabelas novas (RLS por empresa, REVOKE anon, escrita só pela função com guarda Master), colunas novas em
-- erp_compras. Nenhuma função/view/policy existente é alterada. "Master" = mesma regra do bloqueio de pagamento (#1672).

CREATE TABLE IF NOT EXISTS public.erp_compras_alcada_config (
  company_id              uuid PRIMARY KEY,
  aprovador_principal_id  uuid,
  aprovador_substituto_id uuid,
  min_orcamentos          smallint NOT NULL DEFAULT 3 CHECK (min_orcamentos IN (1, 3)),
  urgencia_categorias     text[]   NOT NULL DEFAULT '{}',
  urgencia_produto_ids    uuid[]   NOT NULL DEFAULT '{}',
  atualizado_por          uuid,
  atualizado_em           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_alcada_principal_ne_substituto
    CHECK (aprovador_principal_id IS NULL OR aprovador_principal_id IS DISTINCT FROM aprovador_substituto_id)
);

CREATE TABLE IF NOT EXISTS public.erp_compras_alcada_historico (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  antes      jsonb,
  depois     jsonb NOT NULL,
  user_id    uuid,
  user_email text,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_compras_alcada_hist_empresa ON public.erp_compras_alcada_historico (company_id, criado_em DESC);

ALTER TABLE public.erp_compras_alcada_config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_compras_alcada_historico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS compras_alcada_config_select ON public.erp_compras_alcada_config;
CREATE POLICY compras_alcada_config_select ON public.erp_compras_alcada_config
  FOR SELECT TO authenticated USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
DROP POLICY IF EXISTS compras_alcada_hist_select ON public.erp_compras_alcada_historico;
CREATE POLICY compras_alcada_hist_select ON public.erp_compras_alcada_historico
  FOR SELECT TO authenticated USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
REVOKE ALL ON public.erp_compras_alcada_config, public.erp_compras_alcada_historico FROM anon, public;
REVOKE INSERT, UPDATE, DELETE ON public.erp_compras_alcada_config, public.erp_compras_alcada_historico FROM authenticated;
GRANT SELECT ON public.erp_compras_alcada_config, public.erp_compras_alcada_historico TO authenticated;
GRANT ALL ON public.erp_compras_alcada_config, public.erp_compras_alcada_historico TO service_role;

-- Registro da aprovação na compra (preenchido pelas PRs seguintes: B aprova/recusa).
ALTER TABLE public.erp_compras
  ADD COLUMN IF NOT EXISTS aprovado_por     uuid,
  ADD COLUMN IF NOT EXISTS aprovado_em      timestamptz,
  ADD COLUMN IF NOT EXISTS aprovacao_motivo text;

CREATE OR REPLACE FUNCTION public.fn_compras_alcada_usuario_master(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(public.is_admin(), false)
      OR EXISTS (SELECT 1 FROM public.user_companies uc
                  WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
                    AND lower(uc.role) IN ('socio','sócio','acesso_total','admin','adm'))
      OR EXISTS (SELECT 1 FROM public.tenant_user_roles t
                  WHERE t.user_id = auth.uid() AND t.company_id = p_company_id
                    AND t.role = 'CLIENT_OWNER' AND t.is_active = true)
$$;

CREATE OR REPLACE FUNCTION public.fn_compras_alcada_obter(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c record;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.erp_compras_alcada_config WHERE company_id = p_company_id;
  RETURN jsonb_build_object(
    'configurada', FOUND,
    'aprovador_principal_id',  c.aprovador_principal_id,
    'aprovador_substituto_id', c.aprovador_substituto_id,
    'min_orcamentos',          COALESCE(c.min_orcamentos, 3),
    'urgencia_categorias',     to_jsonb(COALESCE(c.urgencia_categorias, '{}'::text[])),
    'urgencia_produto_ids',    to_jsonb(COALESCE(c.urgencia_produto_ids, '{}'::uuid[])),
    'pode_configurar',         public.fn_compras_alcada_usuario_master(p_company_id));
END $$;

CREATE OR REPLACE FUNCTION public.fn_compras_alcada_salvar(p_company_id uuid, p_config jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_antes jsonb; v_min smallint; v_pri uuid; v_sub uuid; v_cats text[]; v_prods uuid[]; v_email text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF NOT public.fn_compras_alcada_usuario_master(p_company_id) THEN
    RAISE EXCEPTION 'Somente Master pode configurar a alçada de compras' USING ERRCODE = '42501';
  END IF;
  v_min := COALESCE((p_config->>'min_orcamentos')::smallint, 3);
  IF v_min NOT IN (1, 3) THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Nº mínimo de orçamentos deve ser 3 (padrão) ou 1'); END IF;
  v_pri := NULLIF(p_config->>'aprovador_principal_id', '')::uuid;
  v_sub := NULLIF(p_config->>'aprovador_substituto_id', '')::uuid;
  IF v_pri IS NOT NULL AND v_pri = v_sub THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Principal e substituto devem ser pessoas diferentes'); END IF;
  IF v_sub IS NOT NULL AND v_pri IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Defina o aprovador principal antes do substituto'); END IF;
  IF (v_pri IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.user_companies WHERE user_id = v_pri AND company_id = p_company_id))
     OR (v_sub IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.user_companies WHERE user_id = v_sub AND company_id = p_company_id)) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Aprovador precisa ser usuário desta empresa');
  END IF;
  SELECT COALESCE(array_agg(btrim(x)) FILTER (WHERE btrim(x) <> ''), '{}') INTO v_cats
    FROM jsonb_array_elements_text(COALESCE(p_config->'urgencia_categorias', '[]'::jsonb)) x;
  SELECT COALESCE(array_agg(x::uuid), '{}') INTO v_prods
    FROM jsonb_array_elements_text(COALESCE(p_config->'urgencia_produto_ids', '[]'::jsonb)) x;

  v_antes := public.fn_compras_alcada_obter(p_company_id) - 'pode_configurar';
  INSERT INTO public.erp_compras_alcada_config AS c
    (company_id, aprovador_principal_id, aprovador_substituto_id, min_orcamentos, urgencia_categorias, urgencia_produto_ids, atualizado_por, atualizado_em)
  VALUES (p_company_id, v_pri, v_sub, v_min, v_cats, v_prods, auth.uid(), now())
  ON CONFLICT (company_id) DO UPDATE SET
    aprovador_principal_id = EXCLUDED.aprovador_principal_id, aprovador_substituto_id = EXCLUDED.aprovador_substituto_id,
    min_orcamentos = EXCLUDED.min_orcamentos, urgencia_categorias = EXCLUDED.urgencia_categorias,
    urgencia_produto_ids = EXCLUDED.urgencia_produto_ids, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now();
  SELECT email INTO v_email FROM public.users WHERE id = auth.uid();
  INSERT INTO public.erp_compras_alcada_historico (company_id, antes, depois, user_id, user_email)
  VALUES (p_company_id, v_antes, public.fn_compras_alcada_obter(p_company_id) - 'pode_configurar', auth.uid(), v_email);
  RETURN jsonb_build_object('sucesso', true);
END $$;

REVOKE EXECUTE ON FUNCTION public.fn_compras_alcada_usuario_master(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_compras_alcada_obter(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_compras_alcada_salvar(uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_compras_alcada_usuario_master(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_compras_alcada_obter(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_compras_alcada_salvar(uuid, jsonb) TO authenticated, service_role;
