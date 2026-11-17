-- RD-98 p3 · auditor /dashboard/gestao-empresarial/implantacao (onboarding GE):
--   views_consumidas estava NULA (rpcs_chamadas ja preenchida com fn_ge_onboarding_status).
--
-- A tela consome os dados exclusivamente via RPC fn_ge_onboarding_status(p_company_id).
-- Fontes reais lidas por essa funcao (prova no proprio corpo da funcao, RD-38):
--   companies, tenant_subscriptions, erp_banco_contas, erp_lancamentos,
--   erp_contratos, erp_plano_contas, m2_dre_divisional
-- (os 5 passos do onboarding + plano + nome da empresa). 7 relacoes conferidas em pg_class.
--
-- Estado antes (producao): views_consumidas = NULL; rpcs_chamadas = {fn_ge_onboarding_status}.
-- Correcao corretiva e idempotente (so metadado de registro da tela; nao toca RLS, dado de
-- cliente, nem comportamento). Preserva rpcs_chamadas existente.

UPDATE public.system_screens
   SET views_consumidas = ARRAY[
         'companies','tenant_subscriptions','erp_banco_contas','erp_lancamentos',
         'erp_contratos','erp_plano_contas','m2_dre_divisional'
       ]::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/gestao-empresarial/implantacao';
