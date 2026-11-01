-- HB2 · Calculadora de Obra PS: regras (coeficientes, faixas, perdas, embalagens) editáveis POR EMPRESA, como dado.
-- Aditiva: tabela NOVA com RLS por empresa, REVOKE anon; escrita só pela função com guarda de empresa. Faixa 05.
CREATE TABLE IF NOT EXISTS public.erp_calc_regra (
  company_id uuid NOT NULL REFERENCES public.companies(id),
  sistema text NOT NULL CHECK (sistema IN ('parede','forro_f530')),
  regras jsonb NOT NULL CHECK (jsonb_typeof(regras) = 'object'),
  validada boolean NOT NULL DEFAULT false,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid DEFAULT auth.uid(),
  PRIMARY KEY (company_id, sistema)
);
ALTER TABLE public.erp_calc_regra ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_calc_regra_select ON public.erp_calc_regra;
CREATE POLICY erp_calc_regra_select ON public.erp_calc_regra FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
REVOKE ALL ON public.erp_calc_regra FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.erp_calc_regra FROM authenticated;
GRANT SELECT ON public.erp_calc_regra TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_calc_regra_salvar(p_company_id uuid, p_sistema text, p_regras jsonb, p_validada boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF p_sistema NOT IN ('parede','forro_f530') THEN RETURN jsonb_build_object('ok',false,'erro','sistema_invalido'); END IF;
  IF jsonb_typeof(p_regras) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('ok',false,'erro','regras_invalidas'); END IF;
  INSERT INTO erp_calc_regra (company_id, sistema, regras, validada, atualizado_em, atualizado_por)
  VALUES (p_company_id, p_sistema, p_regras, COALESCE(p_validada,false), now(), auth.uid())
  ON CONFLICT (company_id, sistema) DO UPDATE SET regras = EXCLUDED.regras, validada = EXCLUDED.validada,
    atualizado_em = now(), atualizado_por = auth.uid();
  RETURN jsonb_build_object('ok',true);
END $$;

-- volta ao valor de referência (remove só a regra própria da empresa; o padrão está no código)
CREATE OR REPLACE FUNCTION public.fn_calc_regra_restaurar(p_company_id uuid, p_sistema text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  DELETE FROM erp_calc_regra WHERE company_id = p_company_id AND sistema = p_sistema;
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.fn_calc_regra_salvar(uuid,text,jsonb,boolean) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.fn_calc_regra_restaurar(uuid,text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_calc_regra_salvar(uuid,text,jsonb,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_calc_regra_restaurar(uuid,text) TO authenticated;
