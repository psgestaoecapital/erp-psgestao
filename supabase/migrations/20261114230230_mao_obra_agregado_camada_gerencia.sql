-- GAP auditor · /dashboard/industrial/mao-obra (Code: rodrigo-code)
-- Problema: o custo AGREGADO de mão de obra por setor (número gerencial, não-sensível) só é
-- liberado por fn__mao_obra_pode_ver_individual, que hoje olha APENAS user_companies.role e
-- IGNORA o escopo industrial (user_scope.papel_slug). Resultado: um Gerente de Produção
-- (ind_ger_producao) — e todo gestor cujo acesso à empresa vem pelo escopo industrial e não por
-- um role gerencial em user_companies — cai em "Acesso restrito ao RH" e não vê o custo total.
-- O salário POR PESSOA continua restrito ao RH (fn__pode_ver_folha, intocada).
--
-- Correção (aditiva): o gate do AGREGADO passa a reconhecer também as camadas gerenciais do
-- escopo industrial (propriedade/direção/gerência) via rbac_papel.camada — assim o conjunto
-- acompanha o catálogo (papéis gerenciais novos entram sozinhos). Supervisão/operação/especialista
-- seguem FORA (o agregado é número estratégico de gestão). Não devolve nada individual, então não
-- há vazamento de salário (LGPD preservada).
--
-- RD-38 (provado no banco): hoje ganham acesso exatamente ind_ger_producao e ind_ger_administrativo
-- (ambos camada=gerencia) — nenhum papel operacional/supervisão/especialista é incluído.
-- RD-52: migration é arquivo+PR. RD-94.1: CREATE OR REPLACE de função de guarda = SENSÍVEL (revisao-eng-chefe).

CREATE OR REPLACE FUNCTION public.fn__mao_obra_pode_ver_individual(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NULL OR public.is_admin() OR EXISTS (
    SELECT 1 FROM user_companies uc
     WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
       AND uc.role IN ('owner', 'socio', 'diretor', 'gerente', 'financeiro', 'admin', 'adm', 'acesso_total', 'rh', 'rh_industrial'))
  OR EXISTS (
    SELECT 1 FROM user_scope us
      JOIN rbac_papel rp ON rp.slug = us.papel_slug
     WHERE us.user_id = auth.uid() AND us.company_id = p_company_id AND us.ativo
       AND rp.camada IN ('propriedade', 'direcao', 'gerencia'))
$function$;

-- Grants idênticos ao estado atual (CREATE OR REPLACE preserva, reafirmados por segurança): sem anon.
REVOKE EXECUTE ON FUNCTION public.fn__mao_obra_pode_ver_individual(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn__mao_obra_pode_ver_individual(uuid) TO authenticated, service_role;
