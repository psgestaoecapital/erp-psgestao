-- ============================================================
-- PS_ADMIN_CVM · empresas restritas so para quem tem autoridade
-- ============================================================
-- Hierarquia:
--   PS_ADMIN_CVM = todas as empresas, INCLUSIVE as restritas (autoridade CVM 19) · Gilberto, Andre
--   PS_ADMIN     = todas EXCETO as restritas · Jordana, Rodrigo
--   PS_SUPPORT   = suporte, como hoje · Stephany
--   (sem papel)  = apenas as empresas de user_companies
-- user_companies vale SEMPRE, para qualquer papel — vinculo explicito nunca e removido.
-- Esta migration e SCHEMA-ONLY: a coluna default false e nenhum usuario e PS_ADMIN_CVM ainda,
-- entao o comportamento so muda quando o CEO aplicar os UPDATEs (promover os dois + marcar a
-- Wealth restrita). Ate la, e inerte.
--
-- ATENCAO: get_user_company_ids e chamada por TODA a RLS do sistema. A mudanca e estritamente
-- narrowing (nunca abre acesso novo). Provado em rollback com contagem por usuario antes/depois.
-- Substitui o SPEC da flag isolada: mesma mecanica, autoridade explicita por papel.

-- 2.1 o papel novo entra no CHECK
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_system_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_system_role_check
  CHECK (system_role IS NULL OR system_role = ANY (ARRAY[
    'PS_ADMIN_CVM'::text, 'PS_ADMIN'::text, 'PS_SUPPORT'::text]));
COMMENT ON COLUMN public.users.system_role IS
  'PS_ADMIN_CVM = todas as empresas, INCLUSIVE as restritas (autoridade CVM 19). '
  'PS_ADMIN = todas EXCETO as restritas. PS_SUPPORT = suporte. '
  'NULL = apenas as empresas de user_companies.';

-- 2.2 quais empresas sao restritas
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS restrita_ps_admin boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.companies.restrita_ps_admin IS
  'true = empresa sob sigilo (ex.: operacao Wealth CVM 19). Fica fora do bypass de '
  'PS_ADMIN; so PS_ADMIN_CVM ou vinculo explicito em user_companies enxergam. '
  'default false = nenhuma outra empresa e afetada.';

-- 2.3 a funcao que toda a RLS chama
CREATE OR REPLACE FUNCTION public.get_user_company_ids()
 RETURNS SETOF uuid
 LANGUAGE sql STABLE SECURITY DEFINER
AS $function$
  -- vinculo explicito: vale sempre, para qualquer papel
  SELECT company_id FROM user_companies WHERE user_id = auth.uid()
  UNION
  -- PS_ADMIN_CVM: todas, inclusive restritas
  SELECT c.id FROM companies c
  WHERE EXISTS (SELECT 1 FROM users u
                 WHERE u.id = auth.uid() AND u.system_role = 'PS_ADMIN_CVM')
  UNION
  -- PS_ADMIN: todas, EXCETO as restritas
  SELECT c.id FROM companies c
  WHERE COALESCE(c.restrita_ps_admin, false) = false
    AND EXISTS (SELECT 1 FROM users u
                 WHERE u.id = auth.uid() AND u.system_role = 'PS_ADMIN')
$function$;
