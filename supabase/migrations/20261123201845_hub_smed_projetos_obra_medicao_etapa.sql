-- Onda S-MED · slice 1 (Hub · tela 320) — etapas da medição (validação etapa a etapa)
-- ADITIVA (RD-94.1c): tabela NOVA. Base projetos_obra_medicao/_item ficam intactas.
-- IMUTÁVEL: RLS só concede SELECT a authenticated; INSERT/UPDATE/DELETE só pela RPC
--   fn_obra_medicao_etapa_decidir (SECURITY DEFINER · slice seguinte). O histórico é
--   preservado — nada do fluxo é editável direto pelo usuário.
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.projetos_obra_medicao_etapa (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medicao_id         uuid NOT NULL REFERENCES public.projetos_obra_medicao(id) ON DELETE CASCADE,
  company_id         uuid NOT NULL,
  ordem              int  NOT NULL,
  etapa              text NOT NULL
    CHECK (etapa IN ('lancamento','aceite_contratado','engenharia','gestao_pessoas','diretoria','financeiro')),
  responsavel_user_id uuid,
  prazo_em           timestamptz,
  decisao            text CHECK (decisao IN ('aprovado','devolvido')),
  motivo             text,
  decidido_por       uuid,
  decidido_em        timestamptz,
  assinatura         jsonb,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  -- devolução exige motivo
  CONSTRAINT medicao_etapa_motivo_na_devolucao
    CHECK (decisao IS DISTINCT FROM 'devolvido' OR (motivo IS NOT NULL AND length(btrim(motivo)) > 0)),
  CONSTRAINT medicao_etapa_ordem_unica UNIQUE (medicao_id, ordem)
);

COMMENT ON TABLE public.projetos_obra_medicao_etapa IS
  'Hub S-MED · etapas de validação da medição (lançamento→…→financeiro). Imutável: escrita só por RPC.';

CREATE INDEX IF NOT EXISTS idx_medicao_etapa_medicao
  ON public.projetos_obra_medicao_etapa(medicao_id, ordem);
CREATE INDEX IF NOT EXISTS idx_medicao_etapa_responsavel
  ON public.projetos_obra_medicao_etapa(company_id, responsavel_user_id)
  WHERE decisao IS NULL;

ALTER TABLE public.projetos_obra_medicao_etapa ENABLE ROW LEVEL SECURITY;

-- Leitura: só da própria empresa. Sem policy de INSERT/UPDATE/DELETE (imutável; escrita por RPC).
DROP POLICY IF EXISTS medicao_etapa_select ON public.projetos_obra_medicao_etapa;
CREATE POLICY medicao_etapa_select ON public.projetos_obra_medicao_etapa
  FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));

REVOKE ALL ON public.projetos_obra_medicao_etapa FROM anon;
GRANT SELECT ON public.projetos_obra_medicao_etapa TO authenticated;
