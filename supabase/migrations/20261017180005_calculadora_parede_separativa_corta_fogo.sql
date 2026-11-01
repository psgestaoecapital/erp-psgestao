-- HB2 · Calculadora de Obra: sistemas "parede_separativa" e "parede_corta_fogo" (faixas de pé-direito próprias, como dado por empresa). Faixa 05.
-- Só amplia a lista de sistemas aceitos (CHECK de erp_calc_regra/erp_calc_depara e guarda de fn_calc_regra_salvar) e acrescenta textos de ajuda.
DO $$
DECLARE t text; c record;
BEGIN
  FOREACH t IN ARRAY ARRAY['erp_calc_regra','erp_calc_depara'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    FOR c IN SELECT conname FROM pg_constraint
             WHERE conrelid = ('public.' || t)::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%sistema%' LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, c.conname);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (sistema IN (''parede'',''forro_f530'',''forro_aramado'',''revestimento_colado'',''revestimento_estruturado'',''parede_separativa'',''parede_corta_fogo''))', t, t || '_sistema_check');
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.fn_calc_regra_salvar(p_company_id uuid, p_sistema text, p_regras jsonb, p_validada boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF p_sistema NOT IN ('parede','forro_f530','forro_aramado','revestimento_colado','revestimento_estruturado','parede_separativa','parede_corta_fogo') THEN RETURN jsonb_build_object('ok',false,'erro','sistema_invalido'); END IF;
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
 ('projetos.calculadora.regra.parede_separativa.perda', 'Perda (parede separativa)', 'Informe multiplicador de perda aplicado às chapas e perfis (×).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', '×', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 200),
 ('projetos.calculadora.regra.parede_separativa.areachapa', 'Área da chapa (parede separativa)', 'Informe área de uma chapa de gesso (m²).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'm²', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 201),
 ('projetos.calculadora.regra.parede_separativa.comprimentobarra', 'Comprimento da barra (parede separativa)', 'Informe comprimento da barra de perfil (m).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'm', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 202),
 ('projetos.calculadora.regra.parede_separativa.massakgm2', 'Massa (parede separativa)', 'Informe consumo de massa por m² (kg/m²).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'kg/m²', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 203),
 ('projetos.calculadora.regra.parede_separativa.fitamm2', 'Fita (parede separativa)', 'Informe metros de fita por m² (m/m²).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'm/m²', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 204),
 ('projetos.calculadora.regra.parede_separativa.baldekg', 'Balde de massa (parede separativa)', 'Informe peso da embalagem de massa (kg).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'kg', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 205),
 ('projetos.calculadora.regra.parede_separativa.rolofitam', 'Rolo de fita (parede separativa)', 'Informe metros por rolo de fita (m).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'm', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 206),
 ('projetos.calculadora.regra.parede_separativa.chapasporface', 'Chapas por face (parede separativa)', 'Informe camadas de chapa em cada face da parede (un).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'un', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 207),
 ('projetos.calculadora.regra.parede_separativa.rolobandam', 'Rolo de banda (parede separativa)', 'Informe metros por rolo de banda acústica (m).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'm', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 208),
 ('projetos.calculadora.regra.parede_separativa.larolom2', 'Rolo de lã (parede separativa)', 'Informe área de um rolo de lã mineral (m²).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'm²', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 209),
 ('projetos.calculadora.regra.parede_separativa.parafusoporm2.0.6', 'Parafuso — montante a 0,60 (parede separativa)', 'Informe parafusos por m² com montante a cada 0,60 m (un/m²).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'un/m²', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 210),
 ('projetos.calculadora.regra.parede_separativa.parafusoporm2.0.4', 'Parafuso — montante a 0,40 (parede separativa)', 'Informe parafusos por m² com montante a cada 0,40 m (un/m²).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'un/m²', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 211),
 ('projetos.calculadora.regra.parede_separativa.parafusoporm2.0.6d', 'Parafuso — 0,60 duplo (parede separativa)', 'Informe parafusos por m² com montante duplo a cada 0,60 m (un/m²).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'un/m²', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 212),
 ('projetos.calculadora.regra.parede_separativa.parafusoporm2.0.4d', 'Parafuso — 0,40 duplo (parede separativa)', 'Informe parafusos por m² com montante duplo a cada 0,40 m (un/m²).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'un/m²', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 213),
 ('projetos.calculadora.regra.parede_corta_fogo.perda', 'Perda (parede corta-fogo)', 'Informe multiplicador de perda aplicado às chapas e perfis (×).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', '×', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 214),
 ('projetos.calculadora.regra.parede_corta_fogo.areachapa', 'Área da chapa (parede corta-fogo)', 'Informe área de uma chapa de gesso (m²).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'm²', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 215),
 ('projetos.calculadora.regra.parede_corta_fogo.comprimentobarra', 'Comprimento da barra (parede corta-fogo)', 'Informe comprimento da barra de perfil (m).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'm', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 216),
 ('projetos.calculadora.regra.parede_corta_fogo.massakgm2', 'Massa (parede corta-fogo)', 'Informe consumo de massa por m² (kg/m²).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'kg/m²', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 217),
 ('projetos.calculadora.regra.parede_corta_fogo.fitamm2', 'Fita (parede corta-fogo)', 'Informe metros de fita por m² (m/m²).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'm/m²', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 218),
 ('projetos.calculadora.regra.parede_corta_fogo.baldekg', 'Balde de massa (parede corta-fogo)', 'Informe peso da embalagem de massa (kg).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'kg', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 219),
 ('projetos.calculadora.regra.parede_corta_fogo.rolofitam', 'Rolo de fita (parede corta-fogo)', 'Informe metros por rolo de fita (m).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'm', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 220),
 ('projetos.calculadora.regra.parede_corta_fogo.chapasporface', 'Chapas por face (parede corta-fogo)', 'Informe camadas de chapa em cada face da parede (un).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'un', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 221),
 ('projetos.calculadora.regra.parede_corta_fogo.rolobandam', 'Rolo de banda (parede corta-fogo)', 'Informe metros por rolo de banda acústica (m).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'm', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 222),
 ('projetos.calculadora.regra.parede_corta_fogo.larolom2', 'Rolo de lã (parede corta-fogo)', 'Informe área de um rolo de lã mineral (m²).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'm²', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 223),
 ('projetos.calculadora.regra.parede_corta_fogo.parafusoporm2.0.6', 'Parafuso — montante a 0,60 (parede corta-fogo)', 'Informe parafusos por m² com montante a cada 0,60 m (un/m²).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'un/m²', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 224),
 ('projetos.calculadora.regra.parede_corta_fogo.parafusoporm2.0.4', 'Parafuso — montante a 0,40 (parede corta-fogo)', 'Informe parafusos por m² com montante a cada 0,40 m (un/m²).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'un/m²', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 225),
 ('projetos.calculadora.regra.parede_corta_fogo.parafusoporm2.0.6d', 'Parafuso — 0,60 duplo (parede corta-fogo)', 'Informe parafusos por m² com montante duplo a cada 0,60 m (un/m²).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'un/m²', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 226),
 ('projetos.calculadora.regra.parede_corta_fogo.parafusoporm2.0.4d', 'Parafuso — 0,40 duplo (parede corta-fogo)', 'Informe parafusos por m² com montante duplo a cada 0,40 m (un/m²).', 'Entra direto na conta de materiais; vale só para a sua empresa. Valor de referência de mercado, a validar com o fabricante.', 'un/m²', 'Trocar vírgula por ponto de milhar ou deixar o campo vazio.', 227)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
