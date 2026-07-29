-- Lote A · item 1 — FKs aditivas em erp_receber (RD-55: nunca conversão in-place; mantém a coluna texto).
ALTER TABLE public.erp_receber ADD COLUMN IF NOT EXISTS conta_bancaria_id uuid REFERENCES public.erp_banco_contas(id);
ALTER TABLE public.erp_receber ADD COLUMN IF NOT EXISTS centro_custo_id  uuid REFERENCES public.erp_centros_custo(id);

-- Backfill best-effort (casamento por nome, mesma empresa) — não obrigatório.
UPDATE public.erp_receber r SET conta_bancaria_id = c.id
  FROM public.erp_banco_contas c
  WHERE c.company_id = r.company_id AND upper(trim(r.conta_bancaria)) = upper(trim(c.nome)) AND r.conta_bancaria_id IS NULL;
