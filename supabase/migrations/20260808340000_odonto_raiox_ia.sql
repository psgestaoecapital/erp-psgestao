-- SPEC IA-2.1 · Diagnóstico ASSISTIDO por IA no raio-x (Onda IA-2 · visão). RD-56/RD-41/RD-51/RD-26.
-- ASSISTIVO, não diagnóstico: a IA só SUGERE áreas; quem confirma é o dentista (CFO). Nada entra no
-- odontograma sem aceite. Reuso: erp_odonto_imagem (OD-5), fn_odonto_odontograma_marcar (OD-3),
-- aiGuardedCall (#918, feature 'ia_raiox'). Aqui só: cache do resultado por imagem (não reanalisa à toa).

ALTER TABLE public.erp_odonto_imagem
  ADD COLUMN IF NOT EXISTS ia_achados jsonb,
  ADD COLUMN IF NOT EXISTS ia_gerado_em timestamptz;

-- salva o cache da análise (guard por empresa). O front lê ia_achados direto (RLS já é por empresa).
CREATE OR REPLACE FUNCTION public.fn_odonto_raiox_cache_salvar(p_company_id uuid, p_imagem_id uuid, p_achados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  UPDATE erp_odonto_imagem SET ia_achados = p_achados, ia_gerado_em = now()
   WHERE id = p_imagem_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'imagem não encontrada'); END IF;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_raiox_cache_salvar(uuid,uuid,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_raiox_cache_salvar(uuid,uuid,jsonb) TO authenticated;
