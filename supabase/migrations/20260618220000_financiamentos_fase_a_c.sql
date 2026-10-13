-- FASE A · colunas p/ espelhar a planilha + policy DELETE em parcelas
ALTER TABLE public.financiamentos
  ADD COLUMN IF NOT EXISTS modalidade        text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS data_posicao      date,
  ADD COLUMN IF NOT EXISTS fonte_verificacao text NOT NULL DEFAULT '';

ALTER TABLE public.financiamento_parcelas
  ADD COLUMN IF NOT EXISTS tipo                 text    NOT NULL DEFAULT 'amortizacao',
  ADD COLUMN IF NOT EXISTS desconto_adimplencia numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_com_desconto   numeric,
  ADD COLUMN IF NOT EXISTS data_pagamento       date;

DROP POLICY IF EXISTS p_fin_parcelas_del ON public.financiamento_parcelas;
CREATE POLICY p_fin_parcelas_del ON public.financiamento_parcelas
  FOR DELETE USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- FASE C · parcelas em aberto -> contas a pagar (idempotente)
-- ON CONFLICT casa com erp_pagar_ref_externa_unq (company_id, ref_externa_sistema, ref_externa_id).
CREATE OR REPLACE FUNCTION public.fn_financiamento_gerar_pagar(p_financiamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company  uuid;
  v_banco    text;
  v_contrato text;
  v_geradas  int := 0;
BEGIN
  SELECT company_id, banco, contrato
    INTO v_company, v_banco, v_contrato
  FROM public.financiamentos WHERE id = p_financiamento_id;

  IF v_company IS NULL THEN
    RETURN jsonb_build_object('erro','financiamento nao encontrado');
  END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('erro','sem permissao');
  END IF;

  INSERT INTO public.erp_pagar (
    company_id, fornecedor_nome, descricao, categoria,
    valor, data_vencimento, data_competencia, status,
    parcela, ref_externa_id, ref_externa_sistema, importado_em
  )
  SELECT
    p.company_id,
    v_banco,
    'Financiamento '||COALESCE(v_contrato,'')||' · parcela '||p.numero,
    'Financiamento',
    COALESCE(p.valor_com_desconto, p.valor_parcela),
    p.data_vencimento,
    p.data_vencimento,
    'aberto',
    p.numero::text,
    'fin:'||p.financiamento_id||':parc:'||p.numero,
    'financiamento',
    now()
  FROM public.financiamento_parcelas p
  WHERE p.financiamento_id = p_financiamento_id
    AND lower(COALESCE(p.status,'aberta')) <> 'paga'
  ON CONFLICT ON CONSTRAINT erp_pagar_ref_externa_unq DO UPDATE
    SET valor            = EXCLUDED.valor,
        data_vencimento  = EXCLUDED.data_vencimento,
        data_competencia = EXCLUDED.data_competencia,
        ultima_sync      = now();

  GET DIAGNOSTICS v_geradas = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'contas_geradas_ou_atualizadas', v_geradas);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_financiamento_gerar_pagar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_financiamento_gerar_pagar(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_financiamento_gerar_pagar(uuid) IS
'financiamentos-fase-c · idempotente · parcelas em aberto -> erp_pagar (ref_externa_sistema=financiamento, ref_externa_id=fin:<id>:parc:<n>). Fluxo de caixa pega via fn_fluxo_caixa_projecao.';
