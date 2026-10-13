-- SPEC PM-1 (PR-B) · Item de proposta NORMALIZADO (E3). O agency_propostas.itens é jsonb — impede
-- relatório por serviço/margem e deixa salvar proposta com valor e sem item (3 propostas vazias com valor).
-- Cria a tabela e migra as 11 propostas. RD-30: NÃO apaga a coluna itens (fica de backup; a tela passa a ler daqui).
--
-- Auditado 28/08 (RD-38): 11 propostas · 5 com itens · 6 vazias · 3 vazias-com-valor. As 5 com itens têm
-- SUM(itens)==valor_total do cabeçalho (validado). Duas formas de jsonb: a rica (descricao/quantidade/
-- valor_unitario/valor_total,+servico_id/entregaveis) e a legada (item+valor) na PROP-DEMO-001 — as duas tratadas.

CREATE TABLE IF NOT EXISTS public.agency_proposta_itens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  proposta_id    uuid NOT NULL REFERENCES public.agency_propostas(id) ON DELETE CASCADE,
  servico_id     uuid REFERENCES public.agency_servico(id),
  ordem          int  NOT NULL DEFAULT 1,
  descricao      text NOT NULL,
  tipo_servico   text,
  unidade        text NOT NULL DEFAULT 'un',
  periodicidade  text,
  quantidade     numeric(14,4) NOT NULL DEFAULT 1,
  valor_unitario numeric(14,2) NOT NULL DEFAULT 0,
  valor_total    numeric(14,2) GENERATED ALWAYS AS (round(quantidade * valor_unitario, 2)) STORED,
  horas_estimadas numeric(10,2),
  entregaveis    jsonb,
  excluido_em    timestamptz,        -- soft-delete (RD-30)
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_agency_proposta_itens_proposta ON public.agency_proposta_itens (proposta_id) WHERE excluido_em IS NULL;
ALTER TABLE public.agency_proposta_itens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agency_proposta_itens_rw ON public.agency_proposta_itens;
CREATE POLICY agency_proposta_itens_rw ON public.agency_proposta_itens FOR ALL
  USING      (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

-- ── Migração das propostas com itens (idempotente; jsonb permanece como backup — RD-30) ──
INSERT INTO public.agency_proposta_itens
  (company_id, proposta_id, servico_id, ordem, descricao, tipo_servico, unidade, periodicidade,
   quantidade, valor_unitario, horas_estimadas, entregaveis)
SELECT
  p.company_id, p.id,
  -- só grava servico_id se o serviço existir de fato (evita quebrar a FK com id órfão)
  (SELECT s.id FROM public.agency_servico s WHERE s.id = NULLIF(el.e->>'servico_id','')::uuid),
  el.ord::int,
  COALESCE(NULLIF(btrim(el.e->>'descricao'), ''), NULLIF(btrim(el.e->>'item'), ''), 'Item'),
  NULLIF(btrim(el.e->>'tipo_servico'), ''),
  COALESCE(NULLIF(btrim(el.e->>'unidade'), ''), 'un'),
  NULLIF(btrim(el.e->>'periodicidade'), ''),
  COALESCE((el.e->>'quantidade')::numeric, 1),
  COALESCE((el.e->>'valor_unitario')::numeric, (el.e->>'valor')::numeric, 0),
  (el.e->>'horas_estimadas')::numeric,
  CASE WHEN jsonb_typeof(el.e->'entregaveis') IN ('array','object') THEN el.e->'entregaveis' ELSE NULL END
FROM public.agency_propostas p
CROSS JOIN LATERAL jsonb_array_elements(p.itens) WITH ORDINALITY AS el(e, ord)
WHERE p.deleted_at IS NULL
  AND jsonb_typeof(p.itens) = 'array' AND jsonb_array_length(p.itens) > 0
  AND NOT EXISTS (SELECT 1 FROM public.agency_proposta_itens ai WHERE ai.proposta_id = p.id);

-- ── Sincronia jsonb → tabela normalizada ──────────────────────────────────────
-- As RPCs existentes (fn_agency_proposta_criar/editar) continuam gravando o jsonb (backup, RD-30);
-- este trigger espelha para a tabela, que vira a fonte consultável (relatório por serviço/margem).
-- A tela lê da tabela; escreve via RPC (jsonb) → o trigger re-sincroniza. Mirror de dado derivado
-- (não é soft-delete de domínio — a proposta em si continua com deleted_at).
CREATE OR REPLACE FUNCTION public.tg_agency_proposta_itens_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  DELETE FROM public.agency_proposta_itens WHERE proposta_id = NEW.id;
  IF jsonb_typeof(NEW.itens) = 'array' AND jsonb_array_length(NEW.itens) > 0 THEN
    INSERT INTO public.agency_proposta_itens
      (company_id, proposta_id, servico_id, ordem, descricao, tipo_servico, unidade, periodicidade,
       quantidade, valor_unitario, horas_estimadas, entregaveis)
    SELECT NEW.company_id, NEW.id,
      (SELECT s.id FROM public.agency_servico s WHERE s.id = NULLIF(el.e->>'servico_id','')::uuid),
      el.ord::int,
      COALESCE(NULLIF(btrim(el.e->>'descricao'), ''), NULLIF(btrim(el.e->>'item'), ''), 'Item'),
      NULLIF(btrim(el.e->>'tipo_servico'), ''),
      COALESCE(NULLIF(btrim(el.e->>'unidade'), ''), 'un'),
      NULLIF(btrim(el.e->>'periodicidade'), ''),
      COALESCE((el.e->>'quantidade')::numeric, 1),
      COALESCE((el.e->>'valor_unitario')::numeric, (el.e->>'valor')::numeric, 0),
      (el.e->>'horas_estimadas')::numeric,
      CASE WHEN jsonb_typeof(el.e->'entregaveis') IN ('array','object') THEN el.e->'entregaveis' ELSE NULL END
    FROM jsonb_array_elements(NEW.itens) WITH ORDINALITY AS el(e, ord);
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS tg_agency_proposta_itens_sync ON public.agency_propostas;
CREATE TRIGGER tg_agency_proposta_itens_sync
  AFTER INSERT OR UPDATE OF itens ON public.agency_propostas
  FOR EACH ROW EXECUTE FUNCTION public.tg_agency_proposta_itens_sync();
