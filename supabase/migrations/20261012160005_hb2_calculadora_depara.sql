-- Hub HB2 · Calculadora de Obra (fatia 3): de-para de cada material da calculadora com o produto do estoque da empresa.
-- Aditiva: tabela NOVA com RLS ligada, policy por empresa e REVOKE de anon. Sem UPDATE/DELETE em dado existente.
CREATE TABLE IF NOT EXISTS public.erp_calc_depara (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sistema     text NOT NULL CHECK (sistema IN ('parede', 'forro_f530')),
  chave       text NOT NULL CHECK (length(btrim(chave)) > 0),
  produto_id  uuid NOT NULL REFERENCES public.erp_produtos(id) ON DELETE CASCADE,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, sistema, chave)
);
CREATE INDEX IF NOT EXISTS erp_calc_depara_produto_idx ON public.erp_calc_depara (produto_id);

ALTER TABLE public.erp_calc_depara ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_calc_depara_empresa ON public.erp_calc_depara;
CREATE POLICY erp_calc_depara_empresa ON public.erp_calc_depara
  FOR ALL TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
REVOKE ALL ON public.erp_calc_depara FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.erp_calc_depara TO authenticated;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Calculadora de Obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/calculadora', 'hub', 'publicado'
FROM (VALUES
 ('projetos.calculadora.produto', 'Produto do estoque', 'Escolha o produto do estoque da sua empresa que corresponde a este material. Use "Sem vínculo" para desfazer.', 'Traz o custo real do estoque e calcula o valor de cada item e o total da lista.', 'Chapa ST 12,5 mm', 'Vincular um produto de outra unidade de medida: confira a unidade de compra ao lado.', 17),
 ('projetos.calculadora.custo_total', 'Custo estimado', 'Nada a preencher: é o resultado. Soma quantidade × custo médio do produto vinculado.', 'Mostra quanto a compra custa hoje, com o custo real do estoque. Itens sem produto ficam de fora e são avisados.', 'R$ 1.250,00', 'Ler o total como completo quando há itens sem vínculo.', 18)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
