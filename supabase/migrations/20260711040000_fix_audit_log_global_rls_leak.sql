-- ============================================================
-- 🔒 Pilar 2 / LGPD — fecha vazamento cross-tenant em audit_log_global.
-- Achado: a policy `al_all` (cmd ALL, qual=true, with_check=true) ANULAVA
-- todas as demais (RLS é permissivo/OR): qualquer sessão autenticada lia
-- (e podia editar/apagar) a trilha de TODOS os tenants via REST direto,
-- driblando a RPC segura fn_audit_consulta_admin. Prova pré: um usuário SEM
-- tenant enxergava 2.974.860 linhas (a tabela inteira).
--
-- Fix: DROP da policy al_all. As policies corretas já existem e sobrevivem:
--   • INSERT: audit_log_insert (with_check=true) → log segue gravando
--     (e o trigger fn_audit_log_trigger é SECURITY DEFINER de qualquer forma).
--   • SELECT: audit_log_admin_owner_only (admin/socio_ceo do próprio tenant)
--     + audit_log_select (is_admin / PS-master) → tenant-safe.
--   • UPDATE/DELETE: audit_log_no_update/no_delete (false) → log imutável.
-- Reversível (recriar al_all se preciso). Só policy — zero dado, zero código.
-- ============================================================

DROP POLICY IF EXISTS al_all ON public.audit_log_global;
