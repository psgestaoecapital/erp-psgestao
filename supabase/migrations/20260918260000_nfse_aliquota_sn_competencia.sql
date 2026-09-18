-- #90 paridade OMIE — alíquota efetiva do Simples Nacional (pAliq) POR COMPETÊNCIA (mês).
-- No regime SN com regApTribSN=1 o emitente informa a alíquota do mês (percentual_aliquota_relativa_municipio).
-- Sem alíquota cadastrada para a competência → a emissão BLOQUEIA (nunca chuta; mesmo princípio do #32).
-- Idempotente. RLS por empresa; RPC de escrita com guarda; anon sem EXECUTE.

CREATE TABLE IF NOT EXISTS public.erp_fiscal_aliquota_sn (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  competencia date NOT NULL,               -- 1º dia do mês (date_trunc('month', ...))
  aliquota    numeric NOT NULL,            -- alíquota efetiva do Simples do mês (%), informada pelo contador
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, competencia)
);
CREATE INDEX IF NOT EXISTS idx_fiscal_aliquota_sn_company ON public.erp_fiscal_aliquota_sn(company_id, competencia);
ALTER TABLE public.erp_fiscal_aliquota_sn ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fiscal_aliquota_sn_tenant ON public.erp_fiscal_aliquota_sn;
CREATE POLICY fiscal_aliquota_sn_tenant ON public.erp_fiscal_aliquota_sn
  FOR ALL USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.erp_fiscal_aliquota_sn TO authenticated, service_role;

-- Writer (upsert por competência). Guarda de empresa; sem JWT (interno) ou service_role passa. anon sem EXECUTE.
CREATE OR REPLACE FUNCTION public.fn_fiscal_aliquota_sn_salvar(p_company_id uuid, p_competencia date, p_aliquota numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = ''; v_comp date;
BEGIN
  IF p_company_id IS NULL OR p_competencia IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','parametros_ausentes'); END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF p_aliquota IS NULL OR p_aliquota < 0 OR p_aliquota > 100 THEN RETURN jsonb_build_object('ok',false,'erro','aliquota_invalida'); END IF;
  v_comp := date_trunc('month', p_competencia)::date;
  INSERT INTO erp_fiscal_aliquota_sn (company_id, competencia, aliquota, created_by)
  VALUES (p_company_id, v_comp, p_aliquota, auth.uid())
  ON CONFLICT (company_id, competencia) DO UPDATE SET aliquota = EXCLUDED.aliquota, updated_at = now();
  RETURN jsonb_build_object('ok', true, 'competencia', v_comp, 'aliquota', p_aliquota);
END; $function$;
REVOKE EXECUTE ON FUNCTION public.fn_fiscal_aliquota_sn_salvar(uuid, date, numeric) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_fiscal_aliquota_sn_salvar(uuid, date, numeric) TO authenticated, service_role;
