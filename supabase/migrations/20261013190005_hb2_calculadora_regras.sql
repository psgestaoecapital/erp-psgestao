-- Hub HB2 · Calculadora de Obra (fatia 6): regras (coeficientes, perda, embalagens) editáveis por empresa.
-- Aditiva: tabela NOVA com RLS ligada, policy por empresa e REVOKE de anon. Sem UPDATE/DELETE em dado existente.
CREATE TABLE IF NOT EXISTS public.erp_calc_regra (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sistema       text NOT NULL CHECK (sistema IN ('parede', 'forro_f530')),
  regras        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(regras) = 'object'),
  validada_em   timestamptz,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, sistema)
);

ALTER TABLE public.erp_calc_regra ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_calc_regra_empresa ON public.erp_calc_regra;
CREATE POLICY erp_calc_regra_empresa ON public.erp_calc_regra
  FOR ALL TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
REVOKE ALL ON public.erp_calc_regra FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.erp_calc_regra TO authenticated;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Calculadora de Obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/calculadora', 'hub', 'publicado'
FROM (VALUES
 ('projetos.calculadora.regra', 'Coeficiente da empresa', 'Troque o valor de referência pelo que o seu fabricante recomenda. Só números maiores que zero.', 'Entra direto na conta de todos os itens: a quantidade a comprar é recalculada com o seu coeficiente.', 'Perda 1,08', 'Digitar perda como 8 em vez de 1,08: a perda é um multiplicador.', 19),
 ('projetos.calculadora.regra_validada', 'Regras validadas', 'Marque depois de conferir os coeficientes com o fabricante. Nada a calcular.', 'Tira o aviso "referência de mercado a validar" desta calculadora.', 'Validado em 13/10', 'Marcar sem ter conferido com o fabricante.', 20),
 ('projetos.calculadora.regra_restaurar', 'Voltar à referência', 'Nada a preencher: é uma ação. Apaga os ajustes da empresa para este sistema.', 'Volta aos valores de referência de mercado.', 'Restaurar parede simples', 'Restaurar sem querer: os ajustes são apagados.', 21)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
