-- BUG Inventário: valor_diferenca sempre 0. O trigger BEFORE lia NEW.diferenca (coluna GENERATED,
-- NULL em BEFORE). Passa a calcular das colunas base. Zero quando não contado.
CREATE OR REPLACE FUNCTION public.calc_valor_diferenca()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.valor_diferenca := CASE
    WHEN NEW.quantidade_contada IS NULL THEN 0
    ELSE (NEW.quantidade_contada - COALESCE(NEW.quantidade_sistema, 0)) * COALESCE(NEW.custo_unitario, 0)
  END;
  RETURN NEW;
END; $function$;

-- Backup dos valores antigos (dado financeiro histórico) ANTES do backfill, para reversão.
CREATE TABLE IF NOT EXISTS public.erp_inventario_valor_backup_20261013 (
  tabela      text        NOT NULL,
  registro_id uuid        NOT NULL,
  company_id  uuid        NOT NULL,
  valor_antigo numeric,
  salvo_em    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tabela, registro_id)
);
ALTER TABLE public.erp_inventario_valor_backup_20261013 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_inventario_valor_backup_20261013 FROM anon, authenticated;

INSERT INTO public.erp_inventario_valor_backup_20261013 (tabela, registro_id, company_id, valor_antigo)
SELECT 'erp_inventario_itens', id, company_id, valor_diferenca
  FROM public.erp_inventario_itens
 WHERE quantidade_contada IS NOT NULL
   AND valor_diferenca IS DISTINCT FROM (quantidade_contada - COALESCE(quantidade_sistema, 0)) * COALESCE(custo_unitario, 0)
ON CONFLICT DO NOTHING;

INSERT INTO public.erp_inventario_valor_backup_20261013 (tabela, registro_id, company_id, valor_antigo)
SELECT 'erp_inventarios', id, company_id, valor_divergencia
  FROM public.erp_inventarios
ON CONFLICT DO NOTHING;

-- Backfill (só o campo de valor; movimentações já geradas usam diferenca*custo e não são tocadas).
UPDATE public.erp_inventario_itens
   SET valor_diferenca = (quantidade_contada - COALESCE(quantidade_sistema, 0)) * COALESCE(custo_unitario, 0)
 WHERE quantidade_contada IS NOT NULL
   AND valor_diferenca IS DISTINCT FROM (quantidade_contada - COALESCE(quantidade_sistema, 0)) * COALESCE(custo_unitario, 0);

UPDATE public.erp_inventarios i
   SET valor_divergencia = sub.v
  FROM (
    SELECT inventario_id, COALESCE(SUM(valor_diferenca) FILTER (WHERE quantidade_contada IS NOT NULL), 0) AS v
      FROM public.erp_inventario_itens
     GROUP BY inventario_id
  ) sub
 WHERE i.id = sub.inventario_id
   AND i.valor_divergencia IS DISTINCT FROM sub.v;
