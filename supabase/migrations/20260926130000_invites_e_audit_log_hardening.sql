-- HARDENING (decisao CEO 26/09 · PR #1810 · D2=A): fecha os 2 residuais fora do 20260926120000.
-- (1) audit_log_global: anon E authenticated tinham GRANT TRUNCATE (7,3M linhas, LGPD Art.37, retencao 6 anos);
--     RLS nao se aplica a TRUNCATE e o trigger de imutabilidade so cobria UPDATE/DELETE (row-level).
-- (2) invites: o 120000 deixou so o SELECT publico por token (convite/page.tsx:27-31). O app ainda faz, pelo client:
--     admin INSERT/DELETE (dashboard/admin/page.tsx:368,773,790) e UPDATE is_used apos signup (convite/page.tsx:72,
--     usuario recem-criado, ainda fora de user_companies). Sem policy para authenticated esses fluxos param e o
--     convite vira reutilizavel. Nada apagado (RD-30/55). Sem SECURITY DEFINER neste arquivo.

-- ---------- (1) audit_log_global ----------
REVOKE TRUNCATE ON public.audit_log_global FROM anon, authenticated;
DROP TRIGGER IF EXISTS trg_imutavel_audit_log_global_truncate ON public.audit_log_global;
CREATE TRIGGER trg_imutavel_audit_log_global_truncate
  BEFORE TRUNCATE ON public.audit_log_global
  FOR EACH STATEMENT EXECUTE FUNCTION fn_bloqueia_mutacao_auditoria();

-- ---------- (2) invites: por empresa para authenticated ----------
DROP POLICY IF EXISTS invites_select_tenant ON public.invites;
CREATE POLICY invites_select_tenant ON public.invites FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());

DROP POLICY IF EXISTS invites_insert_tenant ON public.invites;
CREATE POLICY invites_insert_tenant ON public.invites FOR INSERT TO authenticated
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

DROP POLICY IF EXISTS invites_delete_tenant ON public.invites;
CREATE POLICY invites_delete_tenant ON public.invites FOR DELETE TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- UPDATE: comportamento atual mantido para authenticated (marcar is_used no signup — o usuario recem-criado ainda nao
-- pertence a empresa). Vira RPC SECURITY DEFINER por token em PR separada; ai esta policy sai. Anon nao tem UPDATE.
DROP POLICY IF EXISTS invites_update_authenticated ON public.invites;
CREATE POLICY invites_update_authenticated ON public.invites FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
