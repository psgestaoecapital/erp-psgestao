-- RD-41 · Oficina — Registro fotográfico do serviço (padrão KGF: sempre foto +
-- descrição escrita). Aditivo, sem valor (FRONTEIRA GE preservada). Foto no bucket
-- privado oficina-recepcao (caminho {company}/servico/{os}/{uuid}.jpg).

CREATE TABLE IF NOT EXISTS public.erp_os_registro_foto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  os_id uuid NOT NULL,
  foto_path text NOT NULL,
  descricao text NOT NULL,
  criado_por uuid,
  criado_por_nome text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_os_registro_foto_os ON public.erp_os_registro_foto(os_id);

ALTER TABLE public.erp_os_registro_foto ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "os_registro_foto auth read" ON public.erp_os_registro_foto;
CREATE POLICY "os_registro_foto auth read" ON public.erp_os_registro_foto FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()));

-- Salvar registro (foto + descrição obrigatórias). Escrita via RPC SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.fn_oficina_registro_salvar(
  p_company_id uuid, p_os_id uuid, p_foto_path text, p_descricao text, p_criado_por_nome text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  IF NULLIF(trim(coalesce(p_foto_path,'')),'') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'foto_obrigatoria'); END IF;
  IF NULLIF(trim(coalesce(p_descricao,'')),'') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'descricao_obrigatoria'); END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_os WHERE id=p_os_id AND company_id=p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada nesta empresa'); END IF;
  INSERT INTO erp_os_registro_foto (company_id, os_id, foto_path, descricao, criado_por, criado_por_nome)
  VALUES (p_company_id, p_os_id, p_foto_path, trim(p_descricao), auth.uid(), nullif(p_criado_por_nome,''))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_oficina_registro_salvar(uuid,uuid,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_oficina_registro_listar(p_company_id uuid, p_os_id uuid)
RETURNS TABLE(id uuid, foto_path text, descricao text, criado_por_nome text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;
  RETURN QUERY SELECT r.id, r.foto_path, r.descricao, r.criado_por_nome, r.created_at
    FROM erp_os_registro_foto r WHERE r.company_id=p_company_id AND r.os_id=p_os_id
    ORDER BY r.created_at DESC;
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_oficina_registro_listar(uuid,uuid) TO authenticated;
