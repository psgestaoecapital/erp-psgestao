-- FASE F · Anti-duplicidade por CHAVE LÓGICA (fornecedor + valor + vencimento EXATO).
-- Complementa o código de barras (Fase A-C): pega a conta idêntica lançada SEM código.
-- Medido antes (RD-38): a chave pega ~2,22% da base (83 grupos) — estreita (venc EXATO,
-- não mês). Alerta 🟡 LEVE, NÃO bloqueia (RD-49). 🔒 escopo company_id (RD-45).
-- MITIGAÇÃO: se AMBAS têm código de barras e são DIFERENTES → documentos distintos → não alerta.
-- 🔒 sem fornecedor → sem alerta. Ignora canceladas. Edição não auto-alerta.
-- RD-44: colunas reais (fornecedor_id, valor, data_vencimento, numero_documento, codigo_barras, created_at).

CREATE INDEX IF NOT EXISTS ix_erp_pagar_chave_logica
  ON public.erp_pagar (company_id, fornecedor_id, data_vencimento, valor)
  WHERE fornecedor_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_pagar_checar_duplicidade_logica(
  p_company_id uuid, p_fornecedor_id uuid, p_valor numeric, p_vencimento date,
  p_codigo_barras text DEFAULT NULL, p_excluir_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, descricao text, valor numeric, vencimento date, status text,
               numero_documento text, codigo_barras text, criado_em timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  SELECT p.id, p.descricao::text, p.valor, p.data_vencimento, p.status::text,
         p.numero_documento::text, p.codigo_barras::text, p.created_at
  FROM public.erp_pagar p
  WHERE p.company_id = p_company_id                                     -- 🔒 explícito (RD-45)
    AND p_fornecedor_id IS NOT NULL AND p.fornecedor_id = p_fornecedor_id  -- sem fornecedor = sem alerta
    AND p.valor = p_valor
    AND p.data_vencimento = p_vencimento
    AND coalesce(p.status, '') <> 'cancelado'                          -- ignora canceladas
    AND (p_excluir_id IS NULL OR p.id <> p_excluir_id)                 -- edição não auto-alerta
    -- MITIGAÇÃO: ambas com código E diferentes → documentos distintos → não alerta
    AND NOT (
      p.codigo_barras IS NOT NULL AND length(coalesce(btrim(p_codigo_barras), '')) > 0
      AND regexp_replace(p.codigo_barras, '\D', '', 'g') <> regexp_replace(p_codigo_barras, '\D', '', 'g')
    )
  ORDER BY p.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.fn_pagar_checar_duplicidade_logica(uuid, uuid, numeric, date, text, uuid) TO authenticated;

-- FASE E · log da decisão do usuário (reusa audit_log). SECURITY DEFINER (bypassa RLS do audit_log).
CREATE OR REPLACE FUNCTION public.fn_pagar_log_duplicidade(
  p_tipo text, p_decisao text, p_detalhe text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_email text;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT email INTO v_email FROM users WHERE id = v_uid;
  INSERT INTO audit_log (user_id, user_email, action, detail, module)
  VALUES (v_uid, v_email,
    'pagar_duplicidade_' || coalesce(p_tipo, '?') || '_' || coalesce(p_decisao, '?'),
    left(coalesce(p_detalhe, ''), 1000), 'financeiro');
END $$;

GRANT EXECUTE ON FUNCTION public.fn_pagar_log_duplicidade(text, text, text) TO authenticated;
