-- =============================================================
-- fiscal-devolucao-venda-e-remessa-v1 · Parte B (DDL + seed)
-- =============================================================
-- Tabela erp_fiscal_remessa_tipos: catalogo parametrizavel de tipos de
-- remessa (conserto, comodato, demonstracao, garantia, etc.).
--
-- company_id NULL = padrao global (visivel a todos os tenants).
-- company_id preenchido = override do tenant.
-- RLS: leitura dos globais + dos do tenant (Pilar 2). Escrita so do tenant.
--
-- Seed (TODO PARAMETRO_CONFIRMAR_COM_CONTADOR): 5 tipos comuns com CFOPs
-- 5xxx (dentro do estado) e 6xxx (fora). User edita o CFOP no modal antes
-- de emitir.
--
-- Aplicada via MCP em 2026-06-15.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.erp_fiscal_remessa_tipos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  nome text NOT NULL,
  natureza text NOT NULL,
  cfop_dentro text NOT NULL,
  cfop_fora text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_remessa_tipos_company ON public.erp_fiscal_remessa_tipos(company_id);

ALTER TABLE public.erp_fiscal_remessa_tipos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS remessa_tipos_read ON public.erp_fiscal_remessa_tipos;
CREATE POLICY remessa_tipos_read ON public.erp_fiscal_remessa_tipos
  FOR SELECT TO public USING (
    company_id IS NULL
    OR company_id IN (SELECT company_id FROM user_companies WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS remessa_tipos_service_role ON public.erp_fiscal_remessa_tipos;
CREATE POLICY remessa_tipos_service_role ON public.erp_fiscal_remessa_tipos
  FOR ALL TO public USING (true);

DROP POLICY IF EXISTS remessa_tipos_write_tenant ON public.erp_fiscal_remessa_tipos;
CREATE POLICY remessa_tipos_write_tenant ON public.erp_fiscal_remessa_tipos
  FOR ALL TO public USING (
    company_id IN (SELECT company_id FROM user_companies WHERE user_id = auth.uid())
  );

INSERT INTO public.erp_fiscal_remessa_tipos (nome, natureza, cfop_dentro, cfop_fora)
SELECT t.nome, t.natureza, t.cfop_dentro, t.cfop_fora
FROM (VALUES
  ('Remessa p/ conserto','Remessa para conserto','5915','6915'),
  ('Retorno de conserto','Retorno de conserto','5916','6916'),
  ('Comodato','Remessa em comodato','5908','6908'),
  ('Demonstração','Remessa para demonstração','5912','6912'),
  ('Garantia','Remessa em garantia','5949','6949')
) AS t(nome, natureza, cfop_dentro, cfop_fora)
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_fiscal_remessa_tipos
  WHERE company_id IS NULL AND nome = t.nome
);
