-- 🚨 SEGURANÇA · HOTFIX (28/09) — dentro da empresa, o usuário podia se dar outro papel.
--
-- A policy user_scope_rls era FOR ALL com USING/CHECK "company_id da empresa do usuário": qualquer pessoa da empresa
-- gravava direto em user_scope (papel, nível, domínios, alçada) — a PRÓPRIA linha e a dos colegas.
-- Provado em rollback 28/09: usuária "RH / ver" virou "Gerente de Planta / editar, domínios TODOS" e rebaixou o
-- gerente de planta real da mesma empresa.
--
-- Nenhuma tela grava user_scope direto: quem grava são as funções SECURITY DEFINER da tela de Acessos
-- (fn_provisionar_user_scope, fn_owner_scope_conceder/revogar), com as travas delas. Então:
-- user_scope fica SÓ LEITURA pela API (mesma regra de empresa para ler); escrita só pelas funções e service_role.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.user_scope FROM anon, authenticated;
REVOKE ALL ON TABLE public.user_scope FROM anon;
GRANT ALL ON TABLE public.user_scope TO service_role;

DROP POLICY IF EXISTS user_scope_rls ON public.user_scope;
DROP POLICY IF EXISTS user_scope_select_empresa ON public.user_scope;
CREATE POLICY user_scope_select_empresa ON public.user_scope FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()));
