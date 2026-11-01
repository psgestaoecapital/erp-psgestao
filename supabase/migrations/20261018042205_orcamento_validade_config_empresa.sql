-- Chamado #3269 (Tryo, HB2): validade do orçamento = emissão + N dias, configurável por empresa.
-- RD-97: ADITIVA. Tabela nova, sem linhas; empresa sem linha continua com os 15 dias de sempre (nada muda sem pedido).
-- Plano de volta: não configurar (ou apagar a linha da empresa) devolve o comportamento anterior; DROP TABLE seguro, ninguém mais a lê.

CREATE TABLE IF NOT EXISTS public.orcamento_config_empresa (
  company_id    uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  validade_dias integer NOT NULL CHECK (validade_dias BETWEEN 1 AND 365),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid
);

ALTER TABLE public.orcamento_config_empresa ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orcamento_config_empresa_rls ON public.orcamento_config_empresa;
CREATE POLICY orcamento_config_empresa_rls ON public.orcamento_config_empresa FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
REVOKE ALL ON public.orcamento_config_empresa FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.orcamento_config_empresa TO authenticated;

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES
 ('orcamentos.config.validade_dias', '/dashboard/orcamentos', 'Orçamento', 'Validade padrão (dias)',
  'Quantos dias o orçamento vale a partir da emissão. Deixe vazio para manter o padrão de 15 dias.',
  'Todo orçamento novo da empresa já nasce com a validade calculada (emissão + este número de dias). Dá para ajustar a data em cada orçamento.',
  'Validade padrão 5 e emissão em 16/10 → o orçamento vence em 21/10.',
  'Achar que muda orçamentos já emitidos: só vale para os novos.',
  'gestao_empresarial', 'publicado')
ON CONFLICT (chave) DO NOTHING;
