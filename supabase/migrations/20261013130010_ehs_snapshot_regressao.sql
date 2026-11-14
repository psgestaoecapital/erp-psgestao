-- PS EHS E0-regressão (camada de dado): snapshot só de contagens por empresa, para
-- comparar "antes × depois" de cada PR da vertical (FRIOESTE, Tryo, R. R). Aditiva, só leitura.
CREATE OR REPLACE FUNCTION public.fn_ehs_snapshot_regressao(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_tabelas text[] := ARRAY[
    'compliance_funcionarios','compliance_setores','compliance_prestadores',
    'compliance_documentos','compliance_epi_assinatura_tokens','epi_catalogo','ind_ponto_pausa'];
  v_t text; v_n bigint; v_out jsonb := '{}'::jsonb;
BEGIN
  FOREACH v_t IN ARRAY v_tabelas LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE company_id = $1', v_t) INTO v_n USING p_company_id;
    v_out := v_out || jsonb_build_object(v_t, v_n);
  END LOOP;
  RETURN jsonb_build_object('company_id', p_company_id, 'contagens', v_out);
END $$;

REVOKE ALL ON FUNCTION public.fn_ehs_snapshot_regressao(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ehs_snapshot_regressao(uuid) TO service_role;
