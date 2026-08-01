-- RD-41 · Oficina — assinaturas tipadas por OS (checklist_ciente na entrada +
-- entrega na saída). Operacional puro (não toca GE/valor/fiscal). Aditivo (RD):
-- tabela nova ao lado; as funções antigas fn_os_assinar(uuid,text) /
-- fn_os_remover_assinatura(uuid) ficam INTACTAS (compat p/ OS já assinadas).
-- Só adicionamos OVERLOADS tipados (assinatura com 3 args / remover com 2 args).

-- 🅰️ 2 assinaturas por OS (1 por tipo). Histórico e novos tipos futuros.
CREATE TABLE IF NOT EXISTS public.erp_os_assinatura (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  os_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('checklist_ciente','entrega')),
  assinatura text NOT NULL,
  assinado_em timestamptz NOT NULL DEFAULT now(),
  assinado_por uuid,
  UNIQUE (os_id, tipo)
);
CREATE INDEX IF NOT EXISTS idx_os_assinatura_os ON public.erp_os_assinatura(os_id);

ALTER TABLE public.erp_os_assinatura ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "os_assinatura auth read" ON public.erp_os_assinatura;
CREATE POLICY "os_assinatura auth read" ON public.erp_os_assinatura FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()));

-- Overload tipado: fn_os_assinar(os, base64, TIPO). p_tipo NULL → legado (erp_os).
CREATE OR REPLACE FUNCTION public.fn_os_assinar(p_os_id uuid, p_assinatura_base64 text, p_tipo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM erp_os WHERE id = p_os_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  IF p_assinatura_base64 IS NULL OR length(p_assinatura_base64) < 50 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Assinatura vazia ou invalida'); END IF;

  IF p_tipo IS NULL THEN  -- compat: assinatura única legada no nível da OS
    UPDATE erp_os SET assinatura_cliente = p_assinatura_base64, assinatura_data = now(), updated_at = now()
     WHERE id = p_os_id;
    RETURN jsonb_build_object('ok', true, 'os_id', p_os_id, 'tipo', NULL);
  END IF;

  IF p_tipo NOT IN ('checklist_ciente','entrega') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tipo_invalido'); END IF;

  INSERT INTO erp_os_assinatura (company_id, os_id, tipo, assinatura, assinado_por)
  VALUES (v_company, p_os_id, p_tipo, p_assinatura_base64, auth.uid())
  ON CONFLICT (os_id, tipo) DO UPDATE
    SET assinatura = EXCLUDED.assinatura, assinado_em = now(), assinado_por = auth.uid();
  RETURN jsonb_build_object('ok', true, 'os_id', p_os_id, 'tipo', p_tipo);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_os_assinar(uuid,text,text) TO authenticated;

-- Overload tipado: fn_os_remover_assinatura(os, TIPO). p_tipo NULL → legado.
CREATE OR REPLACE FUNCTION public.fn_os_remover_assinatura(p_os_id uuid, p_tipo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM erp_os WHERE id = p_os_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  IF p_tipo IS NULL THEN
    UPDATE erp_os SET assinatura_cliente = NULL, assinatura_data = NULL, updated_at = now() WHERE id = p_os_id;
    RETURN jsonb_build_object('ok', true, 'os_id', p_os_id, 'tipo', NULL);
  END IF;
  DELETE FROM erp_os_assinatura WHERE os_id = p_os_id AND tipo = p_tipo;
  RETURN jsonb_build_object('ok', true, 'os_id', p_os_id, 'tipo', p_tipo);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_os_remover_assinatura(uuid,text) TO authenticated;

-- Estado honesto (RD-58): assinaturas tipadas de uma OS (pra mostrar ✓/pendente + render).
CREATE OR REPLACE FUNCTION public.fn_os_assinaturas_listar(p_company_id uuid, p_os_id uuid)
RETURNS TABLE(tipo text, assinatura text, assinado_em timestamptz, assinado_por uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;
  RETURN QUERY SELECT a.tipo, a.assinatura, a.assinado_em, a.assinado_por
    FROM erp_os_assinatura a WHERE a.company_id = p_company_id AND a.os_id = p_os_id;
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_os_assinaturas_listar(uuid,uuid) TO authenticated;
