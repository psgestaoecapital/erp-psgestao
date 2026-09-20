-- Incidente LGPD (B) · RLS de storage para o painel assinar as fotos do bucket PRIVADO system-screenshots.
--
-- O bucket é privado (virado em 20/09 ~10:20). Para o PainelAuditores/Central de Dev gerarem URL assinada
-- no cliente (createSignedUrl), o usuário PS_ADMIN precisa de SELECT em storage.objects desse bucket.
-- service_role (auditor/insight no servidor) já bypassa RLS. anon e authenticated comum: SEM acesso.

DROP POLICY IF EXISTS "ps_admin_le_system_screenshots" ON storage.objects;
CREATE POLICY "ps_admin_le_system_screenshots" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'system-screenshots'
    AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM'))
  );
