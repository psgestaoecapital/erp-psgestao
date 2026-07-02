-- Takeoff · PR-FIX #1 (dedup por hash SHA-256 dos bytes do DWG/PDF/PNG).
-- Corrige o caso Tryo/MAGNUS: re-upload cria erp_obra_planta novo perdendo o radiografado.
-- fn_takeoff_planta_procurar_por_hash: procura duplicata pelo mesmo hash+company (prefere radiografada).
-- fn_takeoff_planta_salvar: ganha p_arquivo_hash (backwards-compat com DEFAULT NULL).
-- Aplicada via MCP em 2026-07-02.

ALTER TABLE public.erp_obra_planta
  ADD COLUMN IF NOT EXISTS arquivo_hash text;

CREATE INDEX IF NOT EXISTS ix_obra_planta_company_hash
  ON public.erp_obra_planta (company_id, arquivo_hash)
  WHERE arquivo_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_takeoff_planta_procurar_por_hash(
  p_company_id uuid,
  p_arquivo_hash text
)
RETURNS TABLE (
  id uuid,
  nome text,
  aps_status text,
  analisado_em timestamptz,
  arquivo_dwg_path text,
  arquivo_path text,
  arquivo_tipo text,
  orcamento_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_arquivo_hash IS NULL OR length(p_arquivo_hash) < 16 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id, p.nome, p.aps_status, p.analisado_em,
         p.arquivo_dwg_path, p.arquivo_path, p.arquivo_tipo, p.orcamento_id
    FROM public.erp_obra_planta p
   WHERE p.company_id = p_company_id
     AND p.arquivo_hash = p_arquivo_hash
   ORDER BY
     (CASE p.aps_status
        WHEN 'radiografado' THEN 1
        WHEN 'traduzindo'   THEN 2
        ELSE                     3 END),
     p.updated_at DESC
   LIMIT 1;
END $$;

GRANT EXECUTE ON FUNCTION public.fn_takeoff_planta_procurar_por_hash(uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_takeoff_planta_salvar(
  p_company_id uuid,
  p_nome text,
  p_arquivo_path text,
  p_arquivo_tipo text DEFAULT NULL,
  p_orcamento_id uuid DEFAULT NULL,
  p_escala text DEFAULT NULL,
  p_arquivo_hash text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.erp_obra_planta (
    company_id, orcamento_id, nome, arquivo_path, arquivo_tipo,
    escala_informada, status, criado_por, arquivo_hash
  )
  VALUES (
    p_company_id, p_orcamento_id, p_nome, p_arquivo_path, p_arquivo_tipo,
    p_escala, 'enviada', auth.uid(), p_arquivo_hash
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.fn_takeoff_planta_salvar(uuid, text, text, text, uuid, text, text)
  TO authenticated, service_role;
