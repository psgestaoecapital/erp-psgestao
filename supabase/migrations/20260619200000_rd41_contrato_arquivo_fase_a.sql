-- RD-41 Fase A · Contrato assinado: upload/download
-- Tabela 1:N (aditivos/versoes) + bucket privado + RLS por empresa
-- via path {company_id}/{contrato_id}/{arquivo}.
-- Fase B (extracao IA) preenchera ia_extraido / ia_extraido_em depois.

-- ====================================================================
-- 1) Tabela de arquivos do contrato
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.erp_contratos_arquivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES public.erp_contratos(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  tipo text NOT NULL DEFAULT 'contrato_assinado',
  nome_arquivo text NOT NULL,
  storage_path text NOT NULL,
  tamanho_bytes bigint,
  mime_type text,
  hash_sha256 text,
  ia_extraido jsonb,
  ia_extraido_em timestamptz,
  enviado_por uuid DEFAULT auth.uid(),
  enviado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_contratos_arquivos_tipo_chk
    CHECK (tipo IN ('contrato_assinado', 'aditivo', 'outro'))
);

ALTER TABLE public.erp_contratos_arquivos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cta_company_select ON public.erp_contratos_arquivos;
CREATE POLICY cta_company_select ON public.erp_contratos_arquivos
  FOR SELECT
  USING (company_id IN (SELECT public.get_user_company_ids()));

DROP POLICY IF EXISTS cta_company_write ON public.erp_contratos_arquivos;
CREATE POLICY cta_company_write ON public.erp_contratos_arquivos
  FOR ALL
  USING (company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()));

CREATE INDEX IF NOT EXISTS idx_cta_contrato
  ON public.erp_contratos_arquivos(contrato_id);

CREATE INDEX IF NOT EXISTS idx_cta_company
  ON public.erp_contratos_arquivos(company_id);

-- ====================================================================
-- 2) Bucket privado 'contratos-assinados'
-- ====================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contratos-assinados',
  'contratos-assinados',
  false,
  10 * 1024 * 1024,                                -- 10 MB
  ARRAY['application/pdf','image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ====================================================================
-- 3) Storage RLS: acesso somente se 1o segmento do path == company_id
--    do usuario.  Padrao: {company_id}/{contrato_id}/{arquivo}.
-- ====================================================================
DROP POLICY IF EXISTS contratos_assinados_select ON storage.objects;
CREATE POLICY contratos_assinados_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'contratos-assinados'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.get_user_company_ids())
  );

DROP POLICY IF EXISTS contratos_assinados_insert ON storage.objects;
CREATE POLICY contratos_assinados_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'contratos-assinados'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.get_user_company_ids())
  );

DROP POLICY IF EXISTS contratos_assinados_update ON storage.objects;
CREATE POLICY contratos_assinados_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'contratos-assinados'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.get_user_company_ids())
  )
  WITH CHECK (
    bucket_id = 'contratos-assinados'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.get_user_company_ids())
  );

DROP POLICY IF EXISTS contratos_assinados_delete ON storage.objects;
CREATE POLICY contratos_assinados_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'contratos-assinados'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.get_user_company_ids())
  );

COMMENT ON TABLE public.erp_contratos_arquivos IS
  'RD-41 Fase A · Arquivos anexados a contratos recorrentes (assinado, aditivos). '
  'storage_path aponta para o bucket privado contratos-assinados. '
  'ia_extraido/ia_extraido_em sao preenchidos pela Fase B (extracao IA).';
