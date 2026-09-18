-- #90 / Focus #242149 — campos da Reforma Tributária (IBS/CBS) do layout NFS-e Nacional, OPCIONAIS
-- por empresa e DESLIGADOS por padrão. Colunas nullable em erp_fiscal_provider_config; nenhum default.
-- Vazio → a chave NÃO vai no JSON (o builder buildNacionalNFSePayload só envia quando preenchido).
-- Confirmar obrigatoriedade/valores com a Focus antes de exigir. Migration idempotente.
ALTER TABLE public.erp_fiscal_provider_config
  ADD COLUMN IF NOT EXISTS reforma_finalidade_emissao      smallint,  -- finNFSe (0 = NFS-e regular)
  ADD COLUMN IF NOT EXISTS reforma_consumidor_final        smallint,  -- indFinal (0 = não · 1 = sim)
  ADD COLUMN IF NOT EXISTS reforma_indicador_destinatario  smallint,  -- indDest (0 = tomador · 1 = outro)
  ADD COLUMN IF NOT EXISTS reforma_ibs_cbs_cst             text,      -- CST · String[3]
  ADD COLUMN IF NOT EXISTS reforma_ibs_cbs_classif_trib    text;      -- cClassTrib · String[6]

-- Writer isolado dos 5 campos da reforma (não mexe no fn_fiscal_salvar_config, que tem 11 args e guarda
-- fraca do saneamento). Vazio → grava NULL (some do JSON). Guarda de empresa; anon sem EXECUTE.
CREATE OR REPLACE FUNCTION public.fn_fiscal_reforma_salvar(p_company_id uuid, p_campos jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = ''; v_n int;
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','company_id_ausente'); END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  UPDATE erp_fiscal_provider_config SET
    reforma_finalidade_emissao     = NULLIF(p_campos->>'finalidade_emissao','')::smallint,
    reforma_consumidor_final       = NULLIF(p_campos->>'consumidor_final','')::smallint,
    reforma_indicador_destinatario = NULLIF(p_campos->>'indicador_destinatario','')::smallint,
    reforma_ibs_cbs_cst            = NULLIF(btrim(p_campos->>'ibs_cbs_cst'),''),
    reforma_ibs_cbs_classif_trib   = NULLIF(btrim(p_campos->>'ibs_cbs_classif_trib'),''),
    atualizado_em = now()
  WHERE company_id = p_company_id AND provider = 'focusnfe' AND ativo = true;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RETURN jsonb_build_object('ok',false,'erro','config_focusnfe_nao_encontrada'); END IF;
  RETURN jsonb_build_object('ok', true, 'atualizados', v_n);
END; $function$;
REVOKE EXECUTE ON FUNCTION public.fn_fiscal_reforma_salvar(uuid, jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_fiscal_reforma_salvar(uuid, jsonb) TO authenticated, service_role;
