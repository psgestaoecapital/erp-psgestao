-- erp_banco_provider_config: faltava a política de ESCRITA do usuário (tenant). Só o backend escrevia.
--
-- Chamado #14 do Rodrigo (Bradesco, RR Serviços). O #1251 consertou o ON CONFLICT; o erro AVANÇOU para
-- "violação de política RLS na tabela erp_banco_provider_config" — progresso, mas ainda travado.
--
-- Causa (auditada no dado, RD-38): a tabela só tinha DUAS políticas —
--   p_banco_provider_sel  → SELECT, PUBLIC, company_id IN get_user_company_ids() OR is_admin()
--   p_banco_provider_adm  → ALL, mas TO service_role (só o backend). using=true/check=true.
-- Não havia política de INSERT/UPDATE para o usuário autenticado. Então o upsert direto do frontend
-- (que a tela de config bancária faz) batia no WITH CHECK e voltava 42501 — para TODA empresa, não só a
-- RR. O que "funcionava" (Sicredi/Sicoob/KGF) passava por RPC SECURITY DEFINER, que ignora RLS; o
-- caminho direto do frontend nunca foi exercitado fora desses. É a régua Sicoob-cêntrica escondendo o
-- bug de outro banco de novo.
--
-- Provado (BEGIN…ROLLBACK, como o Rodrigo AUTENTICADO): sem esta política, o INSERT dá exatamente
-- "42501: new row violates row-level security policy"; com ela, insere (rodrigo_inseriu_ok=1).
--
-- Correção no PADRÃO do sistema (RD-26): espelha erp_fiscal_provider_config.fiscal_provider_isolamento_tenant
-- — uma política tenant FOR ALL, company-scoped. Segredos ficam em vaults (colunas *_vault_id); a linha de
-- config não expõe credencial. A tela de config já é restrita a admin no menu.
DROP POLICY IF EXISTS p_banco_provider_tenant ON public.erp_banco_provider_config;
CREATE POLICY p_banco_provider_tenant ON public.erp_banco_provider_config
  FOR ALL TO public
  USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin())
  WITH CHECK ((company_id IN (SELECT get_user_company_ids())) OR is_admin());
