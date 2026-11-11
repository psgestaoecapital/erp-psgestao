-- HOTFIX 4 — CONTENÇÃO LGPD DA FOLHA (Eng. Chefe 11/11, contexto 15e60b16).
-- Prova RD-38 (produção): folha_competencia, folha_verba, prod_salario_base, rh_pessoa_complemento,
-- rh_rv_participante e rh_rv_lancamento_dia tinham RLS de SELECT só por empresa -> QUALQUER login da empresa lia
-- salário/CPF. Ex.: logistica@frioeste (supervisor) via 1430 linhas de folha_competencia.
--
-- Correção ADITIVA (não apaga dado): uma função única de permissão + troca da policy de SELECT dessas 6 tabelas
-- para "empresa do usuário AND pode ver folha". A ESCRITA continua como está (folha é gravada por service_role no
-- /api/industrial/folha/upload; rh_rv_* e rh_pessoa_complemento por funções SECURITY DEFINER; prod_salario_base
-- por update/delete direto na tela de produtividade — mantido company-scoped). As 11 funções de guarda não são
-- tocadas (RD-91). Agregados por setor/cargo (fn_rh_custo_hora_cargo, fn_prod_posto_custo_hora_cargo,
-- fn_rh_custo_por) são SECURITY DEFINER e seguem respondendo para gestores (grupo < 3 continua somado em "Apoio").
--
-- Prova RD-82 (como usuário, ROLLBACK, só leitura): logistica@frioeste -> folha=0; rh@frioeste -> 1430;
-- gerencia@frioeste -> folha=0, mas fn_prod_posto_custo_hora_cargo responde (ok=true).
--
-- PRÓXIMO PASSO (não nesta PR, decisão do Eng. Chefe): ind_pessoa e ind_ponto_colaborador (nomes/CPF) ainda são
-- lidos pelo Ponto/Quadro/produtividade; serão fechados por setor via user_scope depois — NÃO fechados aqui.

-- 1) Permissão única, fail-closed, SECURITY DEFINER (lê user_companies/user_scope ignorando a RLS deles).
CREATE OR REPLACE FUNCTION public.fn__pode_ver_folha(p_company_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT
    is_admin()
    OR EXISTS (SELECT 1 FROM user_companies uc
                WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
                  AND uc.role IN ('rh_industrial','socio','owner'))
    OR EXISTS (SELECT 1 FROM user_scope us
                WHERE us.user_id = auth.uid() AND us.company_id = p_company_id AND us.ativo
                  AND us.papel_slug IN ('ind_ana_rh','ind_ger_rh','ind_dir_rh','ind_ceo','ind_dono'));
$fn$;
REVOKE ALL ON FUNCTION public.fn__pode_ver_folha(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn__pode_ver_folha(uuid) TO authenticated, service_role;

-- 2) Troca a policy de SELECT (empresa do usuário AND pode ver folha). Escrita inalterada.

-- folha_competencia (policy só de SELECT; escrita via service_role, não usa RLS)
DROP POLICY IF EXISTS folha_competencia_pol ON public.folha_competencia;
CREATE POLICY folha_competencia_pol ON public.folha_competencia
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()) AND fn__pode_ver_folha(company_id));

-- folha_verba (idem)
DROP POLICY IF EXISTS folha_verba_pol ON public.folha_verba;
CREATE POLICY folha_verba_pol ON public.folha_verba
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()) AND fn__pode_ver_folha(company_id));

-- rh_pessoa_complemento (policy só de SELECT; escrita via SECURITY DEFINER fn_rh_pessoa_complemento_salvar/_lote)
DROP POLICY IF EXISTS rh_pessoa_complemento_rls ON public.rh_pessoa_complemento;
CREATE POLICY rh_pessoa_complemento_rls ON public.rh_pessoa_complemento
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()) AND fn__pode_ver_folha(company_id));

-- prod_salario_base (era FOR ALL: separa SELECT restrito das ESCRITAS, que seguem como estavam: company OR is_admin)
DROP POLICY IF EXISTS prod_salario_base_rw ON public.prod_salario_base;
CREATE POLICY prod_salario_base_sel ON public.prod_salario_base
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()) AND fn__pode_ver_folha(company_id));
CREATE POLICY prod_salario_base_ins ON public.prod_salario_base
  FOR INSERT WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
CREATE POLICY prod_salario_base_upd ON public.prod_salario_base
  FOR UPDATE USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
CREATE POLICY prod_salario_base_del ON public.prod_salario_base
  FOR DELETE USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- rh_rv_lancamento_dia (era FOR ALL: SELECT restrito + escrita company-scoped como antes; escrita real é SECURITY DEFINER)
DROP POLICY IF EXISTS rh_rv_lancamento_dia_rls ON public.rh_rv_lancamento_dia;
CREATE POLICY rh_rv_lancamento_dia_sel ON public.rh_rv_lancamento_dia
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()) AND fn__pode_ver_folha(company_id));
CREATE POLICY rh_rv_lancamento_dia_ins ON public.rh_rv_lancamento_dia
  FOR INSERT WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY rh_rv_lancamento_dia_upd ON public.rh_rv_lancamento_dia
  FOR UPDATE USING (company_id IN (SELECT get_user_company_ids())) WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY rh_rv_lancamento_dia_del ON public.rh_rv_lancamento_dia
  FOR DELETE USING (company_id IN (SELECT get_user_company_ids()));

-- rh_rv_participante (idem)
DROP POLICY IF EXISTS rh_rv_participante_rls ON public.rh_rv_participante;
CREATE POLICY rh_rv_participante_sel ON public.rh_rv_participante
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()) AND fn__pode_ver_folha(company_id));
CREATE POLICY rh_rv_participante_ins ON public.rh_rv_participante
  FOR INSERT WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY rh_rv_participante_upd ON public.rh_rv_participante
  FOR UPDATE USING (company_id IN (SELECT get_user_company_ids())) WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY rh_rv_participante_del ON public.rh_rv_participante
  FOR DELETE USING (company_id IN (SELECT get_user_company_ids()));
