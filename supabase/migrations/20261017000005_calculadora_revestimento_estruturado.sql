-- HB2 · Calculadora de Obra: novo sistema "revestimento_estruturado" (1 e 2 chapas) (regras como dado por empresa + de-para com o estoque). Faixa 05.
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
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (sistema IN (''parede'',''forro_f530'',''forro_aramado'',''revestimento_colado'',''revestimento_estruturado''))', t, t || '_sistema_check');
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.fn_calc_regra_salvar(p_company_id uuid, p_sistema text, p_regras jsonb, p_validada boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF p_sistema NOT IN ('parede','forro_f530','forro_aramado','revestimento_colado','revestimento_estruturado') THEN RETURN jsonb_build_object('ok',false,'erro','sistema_invalido'); END IF;
  IF jsonb_typeof(p_regras) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('ok',false,'erro','regras_invalidas'); END IF;
  INSERT INTO erp_calc_regra (company_id, sistema, regras, validada, atualizado_em, atualizado_por)
  VALUES (p_company_id, p_sistema, p_regras, COALESCE(p_validada,false), now(), auth.uid())
  ON CONFLICT (company_id, sistema) DO UPDATE SET regras = EXCLUDED.regras, validada = EXCLUDED.validada,
    atualizado_em = now(), atualizado_por = auth.uid();
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.fn_calc_regra_salvar(uuid,text,jsonb,boolean) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_calc_regra_salvar(uuid,text,jsonb,boolean) TO authenticated;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Calculadora de Obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/calculadora', 'hub', 'publicado'
FROM (VALUES
 ('projetos.calculadora.regra.revestimento_estruturado.perda', 'Perda (revestimento estruturado)', 'Informe multiplicador de perda aplicado às chapas e perfis (×).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', '×', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 100),
 ('projetos.calculadora.regra.revestimento_estruturado.areachapa', 'Área da chapa (revestimento estruturado)', 'Informe área de uma chapa de gesso (m²).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'm²', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 101),
 ('projetos.calculadora.regra.revestimento_estruturado.comprimentobarra', 'Comprimento da barra (revestimento estruturado)', 'Informe comprimento da barra de perfil (m).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'm', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 102),
 ('projetos.calculadora.regra.revestimento_estruturado.massakgm2', 'Massa (revestimento estruturado)', 'Informe consumo de massa por m² (kg/m²).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'kg/m²', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 103),
 ('projetos.calculadora.regra.revestimento_estruturado.fitamm2', 'Fita (revestimento estruturado)', 'Informe metros de fita por m² (m/m²).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'm/m²', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 104),
 ('projetos.calculadora.regra.revestimento_estruturado.baldekg', 'Balde de massa (revestimento estruturado)', 'Informe peso da embalagem de massa (kg).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'kg', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 105),
 ('projetos.calculadora.regra.revestimento_estruturado.rolofitam', 'Rolo de fita (revestimento estruturado)', 'Informe metros por rolo de fita (m).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'm', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 106),
 ('projetos.calculadora.regra.revestimento_estruturado.rolobandam', 'Rolo de banda (revestimento estruturado)', 'Informe metros por rolo de banda acústica (m).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'm', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 107),
 ('projetos.calculadora.regra.revestimento_estruturado.parafusoporm2.0.6', 'Parafuso — montante a 0,60 (revestimento estruturado)', 'Informe parafusos por m² com montante a cada 0,60 m (un/m²).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'un/m²', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 108),
 ('projetos.calculadora.regra.revestimento_estruturado.parafusoporm2.0.4', 'Parafuso — montante a 0,40 (revestimento estruturado)', 'Informe parafusos por m² com montante a cada 0,40 m (un/m²).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'un/m²', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 109),
 ('projetos.calculadora.regra.revestimento_estruturado.parafusoporm2.0.6d', 'Parafuso — 0,60 duplo (revestimento estruturado)', 'Informe parafusos por m² com montante duplo a cada 0,60 m (un/m²).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'un/m²', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 110),
 ('projetos.calculadora.regra.revestimento_estruturado.parafusoporm2.0.4d', 'Parafuso — 0,40 duplo (revestimento estruturado)', 'Informe parafusos por m² com montante duplo a cada 0,40 m (un/m²).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'un/m²', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 111)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
