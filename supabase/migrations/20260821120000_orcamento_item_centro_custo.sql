-- Orçamento · rateio do item aponta pro cadastro CERTO: centro de custo (não setor de RH). GE.
--
-- Correção de premissa (RD-51/RD-52): no #1081 o rateio do item ficou como setor_id →
-- compliance_setores (setor de RH/indústria, onde a pessoa trabalha, e poluído). Rateio de
-- orçamento é CENTRO DE CUSTO/departamento financeiro → erp_centros_custo (já existe, tela
-- /dashboard/cadastros/centros-custo).
--
-- Aditivo (RD-54): adiciona centro_custo_id; setor_id fica DEPRECATED (não dropar). Auditado:
-- 0 itens usaram setor_id (recente, sem UI) → nada a migrar.

ALTER TABLE public.erp_orcamentos_itens
  ADD COLUMN IF NOT EXISTS centro_custo_id uuid REFERENCES public.erp_centros_custo(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.erp_orcamentos_itens.centro_custo_id IS 'Centro de custo p/ rateio gerencial (erp_centros_custo). Fonte certa do rateio.';
COMMENT ON COLUMN public.erp_orcamentos_itens.setor_id IS 'DEPRECATED: rateio migrou p/ centro_custo_id. Mantido por compat; não usar no fluxo de orçamento.';

-- fn_orcamento_salvar_itens: persistir também centro_custo_id (idempotente).
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.fn_orcamento_salvar_itens(uuid,jsonb)'::regprocedure);
  IF d NOT ILIKE '%centro_custo_id%' THEN
    d := replace(d, ',valor_iss,setor_id)', ',valor_iss,setor_id,centro_custo_id)');
    d := replace(d, 'NULLIF(v_item->>''setor_id'','''')::uuid)',
                    'NULLIF(v_item->>''setor_id'','''')::uuid,NULLIF(v_item->>''centro_custo_id'','''')::uuid)');
    EXECUTE d;
  END IF;
END
$mig$;
