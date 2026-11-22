-- Onda C-2 · slice 1 (Hub · tela 315) — item do orçamento estruturado pela EAP
-- ADITIVA (RD-94.1c): tabela NOVA complementar 1:1 do item do orçamento do Hub.
-- RD-26: erp_orcamentos / erp_orcamentos_itens são COMPARTILHADAS com o Comércio —
--        NÃO acrescentar colunas do Hub nelas; usamos esta tabela complementar.
-- Decisão de modelo (CEO 21/11): o LOCAL é dimensão do ITEM, não nível da EAP.
-- RLS por empresa (company_id ∈ get_user_company_ids). Escrita só por RPC (slice 2):
--   só SELECT é concedido a authenticated; writes entram por RPC SECURITY DEFINER.
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.projetos_orcamento_item_eap (
  orcamento_item_id uuid PRIMARY KEY
    REFERENCES public.erp_orcamentos_itens(id) ON DELETE CASCADE,
  company_id        uuid NOT NULL,
  eap_codigo        text NOT NULL,
  ref_padrao_codigo text,
  local_tipo        text REFERENCES public.projetos_local_tipo(codigo),
  local_nome        text,
  quantidade        numeric(18,4) NOT NULL DEFAULT 0,
  custo_material_unit numeric(18,4) NOT NULL DEFAULT 0,
  custo_mao_obra_unit numeric(18,4) NOT NULL DEFAULT 0,
  origem            text NOT NULL DEFAULT 'empresa'
    CHECK (origem IN ('padrao_ps','empresa','importado')),
  criado_em         timestamptz NOT NULL DEFAULT now(),
  atualizado_em     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.projetos_orcamento_item_eap IS
  'Hub · complemento 1:1 do item do orçamento (erp_orcamentos_itens): EAP + local + material×MO. Onda C-2.';

CREATE INDEX IF NOT EXISTS idx_orc_item_eap_company
  ON public.projetos_orcamento_item_eap(company_id);
CREATE INDEX IF NOT EXISTS idx_orc_item_eap_eap
  ON public.projetos_orcamento_item_eap(company_id, eap_codigo);

ALTER TABLE public.projetos_orcamento_item_eap ENABLE ROW LEVEL SECURITY;

-- Leitura: só da própria empresa
DROP POLICY IF EXISTS orc_item_eap_select ON public.projetos_orcamento_item_eap;
CREATE POLICY orc_item_eap_select ON public.projetos_orcamento_item_eap
  FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));

-- Escrita só por RPC (SECURITY DEFINER) — sem policy de escrita para authenticated.
REVOKE ALL ON public.projetos_orcamento_item_eap FROM anon;
GRANT SELECT ON public.projetos_orcamento_item_eap TO authenticated;
