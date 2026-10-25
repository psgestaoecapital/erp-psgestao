-- Hub · Calculadora Gold: histórico de cálculos salvos (com margem e vínculo ao orçamento) + "?" (RD-95).
-- Aditiva: tabela NOVA com RLS ligada, policy por empresa e REVOKE de anon. Sem UPDATE/DELETE em dado existente.
CREATE TABLE IF NOT EXISTS public.erp_calc_historico (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sistema       text NOT NULL CHECK (length(btrim(sistema)) > 0),
  titulo        text NOT NULL DEFAULT '',
  entradas      jsonb NOT NULL DEFAULT '{}'::jsonb,
  itens         jsonb NOT NULL DEFAULT '[]'::jsonb,
  custo_total   numeric(14,2) NOT NULL DEFAULT 0,
  margem_pct    numeric(5,2) NOT NULL DEFAULT 0 CHECK (margem_pct >= 0 AND margem_pct <= 95),
  preco_venda   numeric(14,2) NOT NULL DEFAULT 0,
  orcamento_id  uuid REFERENCES public.erp_orcamentos(id) ON DELETE SET NULL,
  criado_por    uuid DEFAULT auth.uid(),
  criado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS erp_calc_historico_empresa_idx ON public.erp_calc_historico (company_id, criado_em DESC);

ALTER TABLE public.erp_calc_historico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_calc_historico_empresa ON public.erp_calc_historico;
CREATE POLICY erp_calc_historico_empresa ON public.erp_calc_historico
  FOR ALL TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
REVOKE ALL ON public.erp_calc_historico FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.erp_calc_historico TO authenticated;

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('projetos.calculadora.margem', '/dashboard/projetos/calculadora', 'Calculadora', 'hub_projetos', 310, 'Margem (%)',
   'Digite a margem de lucro desejada sobre o preço de venda, de 0 a 95.', 'Mostra o preço de venda e o lucro a partir do custo estimado: preço = custo ÷ (1 − margem).',
   'Custo R$ 1.000 com margem 20% = venda R$ 1.250 e lucro R$ 250', 'Confundir margem com acréscimo sobre o custo: 20% de margem não é custo + 20%.'),
  ('projetos.calculadora.salvar_calculo', '/dashboard/projetos/calculadora', 'Calculadora', 'hub_projetos', 311, 'Salvar cálculo',
   'Opcional: dê um nome ao cálculo (obra, cliente ou ambiente) antes de salvar.', 'Guarda medidas, itens, custo e margem no histórico para reabrir ou conferir depois.',
   'Sala reunião — 2º andar', 'Esperar que salvar já crie o orçamento: use "Adicionar à proposta" para isso.'),
  ('projetos.calculadora.historico', '/dashboard/projetos/calculadora', 'Calculadora', 'hub_projetos', 312, 'Histórico de cálculos',
   'Nada a preencher: lista os últimos cálculos salvos da empresa. Toque em um para reabrir.', 'Reaproveita medidas e margem de cálculos anteriores sem digitar de novo.',
   'Parede simples 12,5 m — R$ 3.420,00', 'Reabrir um cálculo antigo e esquecer que o custo do estoque mudou: o valor é recalculado.'),
  ('projetos.calculadora.adicionar_proposta', '/dashboard/projetos/calculadora', 'Calculadora', 'hub_projetos', 313, 'Adicionar à proposta',
   'Escolha o orçamento em rascunho (ligado ao cliente e à obra) que vai receber os itens.', 'Leva a lista calculada para a proposta e registra o vínculo no histórico.',
   'Orçamento 0042 do cliente Silva', 'Adicionar duas vezes e duplicar os itens na proposta.')
ON CONFLICT (chave) DO NOTHING;
