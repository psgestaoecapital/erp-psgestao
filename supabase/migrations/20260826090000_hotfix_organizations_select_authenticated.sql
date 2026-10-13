-- HOTFIX URGENTE · organizations bloqueou o login de usuários não-admin (regressão do #1138).
-- Ao ligar RLS em organizations com policy org_all = is_admin(), o SELECT que o bootstrap do app
-- faz (config global: plano, cores, limites — 1 linha "PS Gestão e Capital") passou a retornar
-- vazio para não-admin → carregamento infinito (RH Frioeste parada). Autorizado CEO 26/08.
--
-- Correção (aditiva, sem remover as policies existentes): libera SELECT de organizations para
-- QUALQUER usuário autenticado. É tabela de config GLOBAL (sem dado sensível cruzado entre tenants).
-- Escrita continua restrita: org_all (ALL, is_admin) + org_bootstrap_admin_insert (INSERT). RLS segue ligado.
-- Já aplicado ao vivo via MCP no dia do incidente; esta migration versiona o mesmo estado (idempotente).

DROP POLICY IF EXISTS org_select_authenticated ON public.organizations;
CREATE POLICY org_select_authenticated ON public.organizations
  FOR SELECT TO authenticated
  USING (true);
