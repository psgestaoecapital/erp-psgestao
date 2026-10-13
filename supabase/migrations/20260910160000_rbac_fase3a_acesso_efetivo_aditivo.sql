-- ============================================================
-- RBAC industrial · Fase 3a (ADITIVO, narrowing-safe) — fn_acesso_efetivo ganha 'acessos' e 'decidido'
-- ============================================================
-- REGRA (CEO): aditivo primeiro. fn_acesso_efetivo ganha os DOIS campos novos PRESERVANDO byte-a-byte
-- os campos de sempre (role, papel_gestao, nivel, papel_rotulo, org_unidade_id, dominios, areas,
-- restricted). Ninguém quebra — os consumidores legados (useAcesso→papel_gestao, fn_oficina_papel,
-- a tela de impressão da OS) seguem lendo o que sempre leram.
--
-- 'acessos' = a decisão nova, por subgrupo, derivada do papel (rbac_papel_acesso do papel_slug),
--   CAPADA pelo nivel do user_scope como TETO (narrowing): papel que dá 'aprovar' num usuário marcado
--   'ver' entrega 'ver'. Sem papel_slug → {} (a decisão continua vindo do legado).
-- 'decidido' = metadados da decisão (fonte pra a Fase 3b migrar consumidor a consumidor):
--   tem_papel=false significa "ainda decide pelo legado".
--
-- NÃO migra consumidor nenhum (isso é 3b). NÃO remove legado (isso é 3c).

CREATE OR REPLACE FUNCTION public.fn_acesso_efetivo(p_user uuid, p_company uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'user_id', p_user, 'company_id', p_company,
    'role', (SELECT role FROM users WHERE id = p_user),
    'papel_gestao', (SELECT role FROM tenant_user_roles WHERE user_id = p_user AND company_id = p_company AND is_active LIMIT 1),
    'nivel', (SELECT nivel FROM user_scope WHERE user_id = p_user AND company_id = p_company),
    'papel_rotulo', (SELECT papel_rotulo FROM user_scope WHERE user_id = p_user AND company_id = p_company),
    'org_unidade_id', (SELECT org_unidade_id FROM user_scope WHERE user_id = p_user AND company_id = p_company),
    'dominios', (SELECT to_jsonb(dominios) FROM user_scope WHERE user_id = p_user AND company_id = p_company),
    'areas', (SELECT to_jsonb(areas_allowed) FROM user_areas_allowed WHERE user_id = p_user),
    'restricted', (SELECT restricted FROM user_areas_allowed WHERE user_id = p_user),
    -- FASE 3a (aditivo) · decisão por subgrupo, capada pelo TETO do user_scope
    'acessos', COALESCE((
      SELECT jsonb_object_agg(a.subgrupo,
        (ARRAY['ver','filtrar','editar','aprovar'])[
          LEAST(
            array_position(ARRAY['ver','filtrar','editar','aprovar'], a.nivel),
            array_position(ARRAY['ver','filtrar','editar','aprovar'], COALESCE(us.nivel,'ver'))
          )
        ])
      FROM user_scope us
      JOIN rbac_papel_acesso a ON a.papel_slug = us.papel_slug
      WHERE us.user_id = p_user AND us.company_id = p_company
    ), '{}'::jsonb),
    -- FASE 3a (aditivo) · metadados da decisão nova (a 3b lê isto pra migrar consumidor a consumidor)
    'decidido', (
      SELECT jsonb_build_object(
        'tem_papel', (us.papel_slug IS NOT NULL),
        'papel_slug', us.papel_slug,
        'teto', COALESCE(us.nivel, 'ver')
      )
      FROM user_scope us WHERE us.user_id = p_user AND us.company_id = p_company LIMIT 1
    )
  );
$function$;
