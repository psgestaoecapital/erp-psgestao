-- HB2 · Calculadora de Obra: novo sistema "forro_aramado" (regras como dado por empresa + de-para com o estoque). Faixa 05.
-- Só amplia a lista de sistemas aceitos: os CHECK de erp_calc_regra/erp_calc_depara e a guarda de fn_calc_regra_salvar.
DO $$
DECLARE t text; c record;
BEGIN
  FOREACH t IN ARRAY ARRAY['erp_calc_regra','erp_calc_depara'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    FOR c IN SELECT conname FROM pg_constraint
             WHERE conrelid = ('public.' || t)::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%sistema%' LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, c.conname);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (sistema IN (''parede'',''forro_f530'',''forro_aramado''))', t, t || '_sistema_check');
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.fn_calc_regra_salvar(p_company_id uuid, p_sistema text, p_regras jsonb, p_validada boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF p_sistema NOT IN ('parede','forro_f530','forro_aramado') THEN RETURN jsonb_build_object('ok',false,'erro','sistema_invalido'); END IF;
  IF jsonb_typeof(p_regras) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('ok',false,'erro','regras_invalidas'); END IF;
  INSERT INTO erp_calc_regra (company_id, sistema, regras, validada, atualizado_em, atualizado_por)
  VALUES (p_company_id, p_sistema, p_regras, COALESCE(p_validada,false), now(), auth.uid())
  ON CONFLICT (company_id, sistema) DO UPDATE SET regras = EXCLUDED.regras, validada = EXCLUDED.validada,
    atualizado_em = now(), atualizado_por = auth.uid();
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.fn_calc_regra_salvar(uuid,text,jsonb,boolean) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_calc_regra_salvar(uuid,text,jsonb,boolean) TO authenticated;
