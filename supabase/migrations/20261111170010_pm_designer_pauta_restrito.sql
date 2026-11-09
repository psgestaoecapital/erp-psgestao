-- P&M · Papéis da agência e fluxo do designer na pauta (CEO 09/11).
-- Papel do designer = pm_producao (os 10 papéis pm_* já existem em rbac_papel; não criamos papéis novos).
--
-- Regra: quem tem SÓ o papel pm_producao na empresa (sem gestão: CLIENT_OWNER/CLIENT_MANAGER, sem PS_ADMIN/PS_SUPPORT)
--   1) enxerga e edita SÓ os jobs em que é responsavel_id (policies RESTRICTIVE em agency_jobs: SELECT e UPDATE);
--   2) só muda status em duas transições: nao_iniciada -> em_producao e em_producao -> em_aprovacao (gatilho).
-- O gatilho fica NA TABELA (não só na RPC): a tela de produção faz update direto em agency_jobs e a RPC
-- fn_pm_job_mover_status roda como dono (contorna RLS), então só o gatilho cobre todos os caminhos.
-- Não mexe em fn_pm_job_mover_status, em fn_agency_comissao_criar nem na regra de comissão (só em 'publicado').
-- Quem não é designer (gestão, diretor, sócio, demais papéis e outras verticais) continua igual.
-- Sem efeito enquanto ninguém tiver user_scope.papel_slug = 'pm_producao' (hoje ninguém tem).

-- 1) Quem é designer restrito nesta empresa
CREATE OR REPLACE FUNCTION public.fn_pm_so_produtor(p_company uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.user_scope us
                  WHERE us.user_id = auth.uid() AND us.company_id = p_company AND us.ativo AND us.papel_slug = 'pm_producao')
     AND NOT EXISTS (SELECT 1 FROM public.tenant_user_roles tur
                      WHERE tur.user_id = auth.uid() AND tur.company_id = p_company AND tur.is_active
                        AND tur.role IN ('CLIENT_OWNER', 'CLIENT_MANAGER'))
     AND NOT EXISTS (SELECT 1 FROM public.users u
                      WHERE u.id = auth.uid() AND u.system_role IN ('PS_ADMIN', 'PS_ADMIN_CVM', 'PS_SUPPORT'));
$function$;

REVOKE ALL ON FUNCTION public.fn_pm_so_produtor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_so_produtor(uuid) TO authenticated, service_role;

-- 2) Gatilho: designer só move job do qual é responsável, e só nas duas transições do fluxo
CREATE OR REPLACE FUNCTION public.trg_agency_job_produtor_guarda()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.fn_pm_so_produtor(NEW.company_id) THEN
    RETURN NEW;
  END IF;
  IF OLD.responsavel_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Você só move os jobs em que é o responsável.' USING ERRCODE = '42501';
  END IF;
  IF NOT ((OLD.status = 'nao_iniciada' AND NEW.status = 'em_producao')
       OR (OLD.status = 'em_producao' AND NEW.status = 'em_aprovacao')) THEN
    RAISE EXCEPTION 'Designer: só Não Iniciada para Em Produção, e Em Produção para Em Aprovação.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_agency_job_produtor_guarda ON public.agency_jobs;
CREATE TRIGGER trg_agency_job_produtor_guarda
  BEFORE UPDATE OF status ON public.agency_jobs
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.trg_agency_job_produtor_guarda();

-- 3) Visibilidade e edição: restritivas (somam com a agency_jobs_access existente, não a substituem)
DROP POLICY IF EXISTS agency_jobs_produtor_ve_so_seus ON public.agency_jobs;
CREATE POLICY agency_jobs_produtor_ve_so_seus ON public.agency_jobs
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT public.fn_pm_so_produtor(company_id) OR responsavel_id = auth.uid());

DROP POLICY IF EXISTS agency_jobs_produtor_edita_so_seus ON public.agency_jobs;
CREATE POLICY agency_jobs_produtor_edita_so_seus ON public.agency_jobs
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.fn_pm_so_produtor(company_id) OR responsavel_id = auth.uid())
  WITH CHECK (NOT public.fn_pm_so_produtor(company_id) OR responsavel_id = auth.uid());
