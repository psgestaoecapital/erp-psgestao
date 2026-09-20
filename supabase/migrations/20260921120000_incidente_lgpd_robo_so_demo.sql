-- INCIDENTE LGPD 20/09 (contexto 0e8add26) · o robô do auditor SÓ pode ser membro de empresa is_demo.
--
-- Causa-raiz: o usuário do robô (screenshot@psgestao.com, is_robo=true) era membro da Ps Gestao LTDA
-- (real). Ao pedir uma demo da qual NÃO era membro, useCompanyIds caiu no fallback "consolidado"
-- (Todas as Empresas) e a tela renderizou os CNPJs REAIS — fotografados no bucket público.
-- A contenção (remover o robô da PS LTDA, incluir nas 4 demos) já foi feita pelo Eng. Chefe. Aqui a
-- regra vira LEI no banco, para não depender de disciplina manual:
--   (a) o robô é vinculado a TODA empresa is_demo (atual e futura);
--   (b) é PROIBIDO vincular o robô a empresa is_demo=false (trigger recusa);
--   (c) limpeza: remove qualquer vínculo de robô a empresa não-demo que ainda exista.

-- (c) Limpeza idempotente: robô nunca em empresa real.
DELETE FROM public.user_companies uc
USING public.users u, public.companies c
WHERE uc.user_id = u.id AND u.is_robo = true
  AND c.id = uc.company_id AND COALESCE(c.is_demo, false) = false;

-- (a) Backfill: todo robô em toda empresa is_demo (role adm/origem manual, como as atuais). Idempotente.
INSERT INTO public.user_companies (user_id, company_id, role, origem)
SELECT u.id, c.id, 'adm', 'manual'
FROM public.users u
CROSS JOIN public.companies c
WHERE u.is_robo = true AND c.is_demo = true
  AND NOT EXISTS (SELECT 1 FROM public.user_companies x WHERE x.user_id = u.id AND x.company_id = c.id);

-- (b) Trigger: recusa vincular robô a empresa is_demo=false (fail-closed; empresa inexistente também recusa).
CREATE OR REPLACE FUNCTION public.fn_uc_robo_so_demo()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_robo boolean; v_demo boolean;
BEGIN
  SELECT is_robo INTO v_robo FROM users WHERE id = NEW.user_id;
  IF COALESCE(v_robo, false) THEN
    SELECT is_demo INTO v_demo FROM companies WHERE id = NEW.company_id;
    IF COALESCE(v_demo, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'LGPD: usuário robô (%) só pode ser vinculado a empresa is_demo=true (empresa %)', NEW.user_id, NEW.company_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_uc_robo_so_demo ON public.user_companies;
CREATE TRIGGER trg_uc_robo_so_demo
  BEFORE INSERT OR UPDATE OF user_id, company_id ON public.user_companies
  FOR EACH ROW EXECUTE FUNCTION public.fn_uc_robo_so_demo();

-- (a-futuro) Trigger: quando uma empresa vira is_demo=true (ou nasce demo), vincula os robôs a ela.
CREATE OR REPLACE FUNCTION public.fn_companies_vincula_robo()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_demo = true THEN
    INSERT INTO public.user_companies (user_id, company_id, role, origem)
    SELECT u.id, NEW.id, 'adm', 'manual'
    FROM public.users u
    WHERE u.is_robo = true
      AND NOT EXISTS (SELECT 1 FROM public.user_companies x WHERE x.user_id = u.id AND x.company_id = NEW.id);
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_companies_vincula_robo ON public.companies;
CREATE TRIGGER trg_companies_vincula_robo
  AFTER INSERT OR UPDATE OF is_demo ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.fn_companies_vincula_robo();
