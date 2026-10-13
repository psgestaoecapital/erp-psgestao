-- =====================================================================
-- REMESSA CNAB 240 DE PAGAMENTO · F1 — fundação (tabelas + salvaguardas)
-- =====================================================================
-- 🔴 DINHEIRO SAINDO. O motor/gerador vive em src/lib/banco/cnab240 (provado byte a byte contra os .rem
-- reais do Sicoob em docs/cnab/). Aqui ficam a persistência da remessa, a NUMERAÇÃO sequencial única, a
-- ANTI-DUPLICAÇÃO (título em remessa ativa não entra em outra) e o rastro (gerado_por/gerado_em + audit_log).
-- RD-30 soft-delete (status 'cancelado', nunca DELETE) · RD-54/55 aditivo · RD-57 trava testada em todo caminho.

CREATE TABLE IF NOT EXISTS public.erp_remessa_pagamento (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  banco_provider_id     uuid REFERENCES public.erp_banco_provider_config(id),
  ambiente              text NOT NULL DEFAULT 'homologacao' CHECK (ambiente IN ('homologacao','producao')),
  numero_sequencial     integer NOT NULL,                 -- Sicoob rejeita nº repetido → único por empresa/banco
  status                text NOT NULL DEFAULT 'rascunho'
                          CHECK (status IN ('rascunho','gerado','enviado','retorno_parcial','concluido','cancelado')),
  arquivo_nome          text,
  total_titulos         integer NOT NULL DEFAULT 0,
  valor_total           numeric NOT NULL DEFAULT 0,
  gerado_por            uuid DEFAULT auth.uid(),          -- rastreabilidade: quem
  gerado_em             timestamptz,                       -- quando
  aprovado_por          uuid,                              -- (SPEC: confirmação do próprio operador; sem 2º aprovador)
  retorno_importado_em  timestamptz,
  observacao            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_remessa_numeracao UNIQUE (company_id, banco_provider_id, numero_sequencial)
);
CREATE INDEX IF NOT EXISTS ix_remessa_company ON public.erp_remessa_pagamento(company_id, status);

CREATE TABLE IF NOT EXISTS public.erp_remessa_pagamento_item (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remessa_id         uuid NOT NULL REFERENCES public.erp_remessa_pagamento(id) ON DELETE CASCADE,
  erp_pagar_id       uuid NOT NULL REFERENCES public.erp_pagar(id),
  forma              text NOT NULL CHECK (forma IN ('boleto','pix','transferencia','tributo')),
  valor              numeric NOT NULL,
  status_item        text NOT NULL DEFAULT 'incluido'
                       CHECK (status_item IN ('incluido','enviado','pago','rejeitado','pendente')),
  ocorrencia_retorno text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_remessa_item UNIQUE (remessa_id, erp_pagar_id)
);
CREATE INDEX IF NOT EXISTS ix_remessa_item_titulo ON public.erp_remessa_pagamento_item(erp_pagar_id);

-- ---------------------------------------------------------------------
-- SALVAGUARDA 1 — ANTI-DUPLICAÇÃO (RD-57): título em remessa ATIVA não entra em outra.
-- Remessa ativa = status em ('gerado','enviado','retorno_parcial'). Rascunho não trava (ainda editável);
-- cancelado/concluído liberam o título. Trava no BANCO (defesa em profundidade, além da UI).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_remessa_item_antidup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.erp_remessa_pagamento_item i
    JOIN public.erp_remessa_pagamento r ON r.id = i.remessa_id
    WHERE i.erp_pagar_id = NEW.erp_pagar_id
      AND i.id <> NEW.id
      AND r.status IN ('gerado','enviado','retorno_parcial')
  ) THEN
    RAISE EXCEPTION 'Título % já está numa remessa ativa (gerada/enviada) — não pode entrar em outra remessa.', NEW.erp_pagar_id
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_remessa_item_antidup ON public.erp_remessa_pagamento_item;
CREATE TRIGGER trg_remessa_item_antidup
  BEFORE INSERT OR UPDATE OF erp_pagar_id ON public.erp_remessa_pagamento_item
  FOR EACH ROW EXECUTE FUNCTION public.fn_remessa_item_antidup();

-- ---------------------------------------------------------------------
-- SALVAGUARDA 2 — NUMERAÇÃO sequencial única por empresa/banco (o Sicoob rejeita repetido).
-- Continua de onde parou (max+1). O nº-base pode ser ajustado pelo CEO ao migrar do sistema atual.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_remessa_proxima_numeracao(p_company uuid, p_banco uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(max(numero_sequencial), 0) + 1
  FROM public.erp_remessa_pagamento
  WHERE company_id = p_company AND banco_provider_id IS NOT DISTINCT FROM p_banco;
$$;

-- ---------------------------------------------------------------------
-- RLS — vê quem é da empresa; grava/gera quem pode gerir a empresa (operador BPO autorizado).
-- ---------------------------------------------------------------------
ALTER TABLE public.erp_remessa_pagamento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_remessa_sel ON public.erp_remessa_pagamento;
CREATE POLICY p_remessa_sel ON public.erp_remessa_pagamento FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
DROP POLICY IF EXISTS p_remessa_wri ON public.erp_remessa_pagamento;
CREATE POLICY p_remessa_wri ON public.erp_remessa_pagamento FOR ALL
  USING ((company_id IN (SELECT get_user_company_ids()) AND fn_acessos_pode_gerir(company_id)) OR is_admin())
  WITH CHECK ((company_id IN (SELECT get_user_company_ids()) AND fn_acessos_pode_gerir(company_id)) OR is_admin());

ALTER TABLE public.erp_remessa_pagamento_item ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_remessa_item_sel ON public.erp_remessa_pagamento_item;
CREATE POLICY p_remessa_item_sel ON public.erp_remessa_pagamento_item FOR SELECT
  USING (remessa_id IN (SELECT id FROM public.erp_remessa_pagamento WHERE company_id IN (SELECT get_user_company_ids())) OR is_admin());
DROP POLICY IF EXISTS p_remessa_item_wri ON public.erp_remessa_pagamento_item;
CREATE POLICY p_remessa_item_wri ON public.erp_remessa_pagamento_item FOR ALL
  USING (remessa_id IN (SELECT id FROM public.erp_remessa_pagamento r WHERE r.company_id IN (SELECT get_user_company_ids()) AND fn_acessos_pode_gerir(r.company_id)) OR is_admin())
  WITH CHECK (remessa_id IN (SELECT id FROM public.erp_remessa_pagamento r WHERE r.company_id IN (SELECT get_user_company_ids()) AND fn_acessos_pode_gerir(r.company_id)) OR is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.erp_remessa_pagamento TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.erp_remessa_pagamento_item TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_remessa_proxima_numeracao(uuid, uuid) TO authenticated;
