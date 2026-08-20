-- Cadastro de Serviço · Categoria vira vínculo ao Plano de Contas (RD-52 fonte única).
--
-- Antes: erp_servicos.categoria é texto livre → cada um escreve diferente, não bate com o plano de
-- contas, DRE/relatórios ficam soltos. Agora a categoria vira um VÍNCULO real ao plano.
--
-- Premissas auditadas (premissa-primeiro, RD-38 / RD-51 — corrige a premissa do SPEC):
--  • A tabela canônica é erp_plano_contas (NÃO 'plano_contas'): as RPCs fn_plano_contas_buscar /
--    _criar_inline / _arvore leem e escrevem em erp_plano_contas.
--  • O app inteiro linka o plano por `codigo` (texto hierárquico, ex.: '1.01.95'), não por id: as
--    RPCs devolvem `codigo`, nunca `id`; e o mesmo `codigo` existe como template global
--    (company_id IS NULL) e como cópia da empresa — logo `codigo` não é único e um FK uuid a uma
--    linha global seria frágil. Por isso o vínculo é `categoria_codigo` (consistente com despesa/
--    receber, que também guardam o codigo), e NÃO um `categoria_id uuid` como o SPEC supôs.
--  • Serviço é receita → o seletor filtra tipo='receita' (aplicacao='receber').
--  • Match do backfill (dado real): 2/2 serviços com categoria casam
--    ('Clientes - Mão de Obra Gessos'→1.01.95, 'Clientes - Serviços Prestados'→1.01.02).

-- 1) Coluna de vínculo (o codigo do plano). Mantém `categoria` (texto) denormalizado p/ exibição.
ALTER TABLE public.erp_servicos
  ADD COLUMN IF NOT EXISTS categoria_codigo text;

COMMENT ON COLUMN public.erp_servicos.categoria_codigo IS 'Vínculo ao Plano de Contas (erp_plano_contas.codigo, tipo=receita). Fonte única da categoria.';
COMMENT ON COLUMN public.erp_servicos.categoria IS 'Nome denormalizado da categoria (sincronizado de erp_plano_contas.descricao via trigger). Legado: pode ter texto livre sem vínculo.';

-- 2) Trigger: mantém `categoria` (texto) sincronizado com a descrição do plano a partir do codigo.
--    SECURITY DEFINER pra enxergar os templates globais (company_id IS NULL) independentemente de RLS.
CREATE OR REPLACE FUNCTION public.fn_servico_sync_categoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_desc text;
BEGIN
  IF NEW.categoria_codigo IS NOT NULL AND btrim(NEW.categoria_codigo) <> '' THEN
    SELECT p.descricao INTO v_desc
    FROM public.erp_plano_contas p
    WHERE p.codigo = btrim(NEW.categoria_codigo)
      AND (p.company_id = NEW.company_id OR p.company_id IS NULL)
    ORDER BY (p.company_id = NEW.company_id) DESC NULLS LAST
    LIMIT 1;
    IF v_desc IS NOT NULL THEN
      NEW.categoria := v_desc;  -- denormalizado sempre reflete a fonte única
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_servico_sync_categoria ON public.erp_servicos;
CREATE TRIGGER trg_servico_sync_categoria
  BEFORE INSERT OR UPDATE OF categoria_codigo ON public.erp_servicos
  FOR EACH ROW EXECUTE FUNCTION public.fn_servico_sync_categoria();

-- 3) Backfill: casa o texto atual com uma receita do plano por nome (empresa preferida > global).
--    Só atualiza quem casa (EXISTS) — não-casados ficam só com o texto (sem quebrar). Idempotente.
UPDATE public.erp_servicos s
SET categoria_codigo = (
  SELECT p.codigo FROM public.erp_plano_contas p
  WHERE p.tipo = 'receita' AND p.ativo
    AND (p.company_id = s.company_id OR p.company_id IS NULL)
    AND lower(btrim(p.descricao)) = lower(btrim(s.categoria))
  ORDER BY (p.company_id = s.company_id) DESC NULLS LAST
  LIMIT 1
)
WHERE s.categoria IS NOT NULL AND btrim(s.categoria) <> '' AND s.categoria_codigo IS NULL
  AND EXISTS (
    SELECT 1 FROM public.erp_plano_contas p
    WHERE p.tipo = 'receita' AND p.ativo
      AND (p.company_id = s.company_id OR p.company_id IS NULL)
      AND lower(btrim(p.descricao)) = lower(btrim(s.categoria))
  );
