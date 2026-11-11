-- HOTFIX 3 — ALINHAR a policy de industrial_plants ao spec EXATO do Eng. Chefe (11/11).
-- A #4560 (já no ar) resolveu o gerente (vê 1 Frioeste, 0 outras), mas com uma policy mais ampla do que o pedido:
-- FOR ALL, com OR is_admin() e WITH CHECK. O Eng. Chefe pediu o mínimo: só leitura por empresa, SEM is_admin
-- (is_admin via org da PS = risco de vazamento entre empresas) e sem tocar na escrita.
--
-- Seguro: o app só LÊ industrial_plants (todas as telas usam .select; não há insert/update/delete no app);
-- a escrita é por migration/seed em service_role, que ignora RLS. Logo uma policy só de SELECT não quebra nada.
--
-- Prova RD-82 (as gerencia@ ce5a9477, get_user_company_ids()={Frioeste 975365cc}, is_admin=false):
-- industrial_plants visíveis = 1 (Frioeste) e 0 das outras 3 empresas — igual ao que já está no ar (o is_admin
-- da #4560 não muda o resultado do gerente, que não é admin); confirmo live pós-deploy.

DROP POLICY IF EXISTS "industrial_plants visiveis por empresa" ON public.industrial_plants;

CREATE POLICY industrial_plants_por_empresa ON public.industrial_plants
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()));
