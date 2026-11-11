-- HOTFIX 3 (Eng. Chefe 11/11) — policy de industrial_plants por EMPRESA (gerente de produção parado na fábrica).
-- Prova RD-38: a tabela industrial_plants tem RLS e company_id; são 4 plantas, em 4 empresas DIFERENTES, mas todas
-- no MESMO org (c830f980, o org da Frioeste). A única policy ("Users see own org plants", cmd ALL) filtra por ORG,
-- não por empresa: company_id IN (companies WHERE org_id = (users.org_id WHERE id=auth.uid())). Dois efeitos ruins:
--   (1) depende de public.users.org_id — para o gerente da Frioeste (ce5a9477) esse caminho devolve VAZIO, então
--       ele NÃO vê nem a própria planta (vê 0) → parado na fábrica;
--   (2) para quem o org bate, vaza as plantas de TODAS as empresas do org (cross-company) — fere o isolamento/LGPD.
--
-- Correção (padrão do ERP, igual ao de prod_posto): escopo por EMPRESA do usuário —
--   company_id IN (SELECT get_user_company_ids()) OR is_admin()  — em USING e WITH CHECK.
--
-- Prova RD-38 (as gerencia@ ce5a9477, get_user_company_ids() = {Frioeste 975365cc}, is_admin()=false):
--   antes: vê 0 plantas (bug). depois: vê 1 (a da Frioeste) e 0 das outras 3 empresas. (confirmado no dado:
--   1 planta na Frioeste, 3 em outras empresas). Sensível (RLS) → revisao-eng-chefe.

DROP POLICY IF EXISTS "Users see own org plants" ON public.industrial_plants;

CREATE POLICY "industrial_plants visiveis por empresa" ON public.industrial_plants
  FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
