-- nfe-recebidas-f1-distribuicao-dfe · habilitar/desabilitar empresa
-- Eligibilidade padronizada (principio Focus registrado, multi-tenant):
--   (1) certificado A1 ativo: status='ativo', removido_em IS NULL,
--       validade_fim > now()
--   (2) qualquer config fiscal ativa com focus_token_vault_id NOT NULL
-- NAO exige provider='focusnfe' explicito · provider eh implicito hoje.
-- Guarda de acesso: company IN get_user_company_ids OR is_admin.
-- Retorno jsonb: { ok, habilitado, ultimo_nsu, motivo? }

CREATE OR REPLACE FUNCTION public.fn_nfe_distribuicao_habilitar(
  p_company_id uuid,
  p_habilitar boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tem_cert boolean;
  v_tem_token boolean;
  v_ultimo_nsu bigint;
BEGIN
  IF NOT (
    p_company_id IN (SELECT get_user_company_ids())
    OR is_admin()
  ) THEN
    RAISE EXCEPTION 'sem acesso a empresa' USING ERRCODE='42501';
  END IF;

  IF p_habilitar THEN
    SELECT EXISTS (
      SELECT 1 FROM public.erp_certificados_a1
      WHERE company_id = p_company_id
        AND status = 'ativo'
        AND removido_em IS NULL
        AND validade_fim > now()::date
    ) INTO v_tem_cert;

    IF NOT v_tem_cert THEN
      RETURN jsonb_build_object(
        'ok', false,
        'habilitado', false,
        'motivo', 'cert_a1_ausente_ou_expirado'
      );
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.erp_fiscal_provider_config
      WHERE company_id = p_company_id
        AND ativo = true
        AND focus_token_vault_id IS NOT NULL
    ) INTO v_tem_token;

    IF NOT v_tem_token THEN
      RETURN jsonb_build_object(
        'ok', false,
        'habilitado', false,
        'motivo', 'token_focus_ausente_no_cofre'
      );
    END IF;
  END IF;

  INSERT INTO public.erp_nfe_distribuicao_controle (company_id, habilitado, updated_at)
  VALUES (p_company_id, p_habilitar, now())
  ON CONFLICT (company_id) DO UPDATE
  SET habilitado = EXCLUDED.habilitado,
      updated_at = now()
  RETURNING ultimo_nsu INTO v_ultimo_nsu;

  RETURN jsonb_build_object(
    'ok', true,
    'habilitado', p_habilitar,
    'ultimo_nsu', COALESCE(v_ultimo_nsu, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_nfe_distribuicao_habilitar(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nfe_distribuicao_habilitar(uuid, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_nfe_distribuicao_habilitar(uuid, boolean) IS
'nfe-recebidas-f1-distribuicao-dfe · liga/desliga DF-e por empresa apos validar cert A1 + token no cofre. Sem ramificar por provider (focusnfe implicito).';
