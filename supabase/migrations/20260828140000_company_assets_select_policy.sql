-- FIX-LOGO-RLS · falta a policy de SELECT no bucket company-assets (upload do logo falhava por RLS).
--
-- Diagnóstico (auditado 28/08): o upload usa upsert:true — o storage checa a EXISTÊNCIA do objeto
-- (um SELECT em storage.objects) antes de gravar. O bucket company-assets tem policies de INSERT
-- (company_assets_write), UPDATE e DELETE, mas NENHUMA de SELECT → o RLS recusa a checagem e o upload
-- falha, mesmo com o path correto ({company_id}/logo.ext) e get_user_company_ids() retornando a empresa.
-- (O "público" do bucket só libera leitura pela URL pública; não cria SELECT no RLS pro upsert.)
--
-- Todo bucket que funciona tem SELECT (contratos_assinados_select, odonto_imagens_sel,
-- oficina_recepcao_sel, fiscal_xmls_select_company...) e o projetos-plantas usa uma policy FOR ALL.
-- Espelho o padrão dos irmãos do próprio company-assets: MESMA expressão das outras 3 policies.
-- Idempotente (DROP IF EXISTS). Validado em BEGIN…ROLLBACK.

DROP POLICY IF EXISTS company_assets_select ON storage.objects;
CREATE POLICY company_assets_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'company-assets'
    AND (storage.foldername(name))[1] IN (SELECT get_user_company_ids()::text)
  );
