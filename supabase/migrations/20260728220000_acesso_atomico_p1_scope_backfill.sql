-- PROVISIONAMENTO DE ACESSO · Parte 1/3 — user_scope como parte do provisionamento + BACKFILL.
-- Raiz do bug (RD-52): nenhuma função de cadastro grava user_scope (salvar_pessoa/convidar gravam
-- users.role/tenant_user_roles/user_areas_allowed mas NÃO user_scope). Resultado: rh2@frioeste ficou sem
-- user_scope.nivel → telas não reconhecem o nível. Aqui: chave de upsert + helper único + backfill de TODOS
-- os incompletos. RD-54: backup antes de mutar. RD-57: o helper serve todos os caminhos (patch nas Partes 2/3).

-- RD-54 · backup do estado atual de user_scope antes de completar
CREATE TABLE IF NOT EXISTS public._bkp_user_scope_20260728 AS SELECT * FROM public.user_scope;

-- chave de upsert idempotente (não havia unique por user+empresa; confirmado 0 duplicatas)
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_scope_user_company ON public.user_scope(user_id, company_id);

-- HELPER único: grava/atualiza user_scope de forma consistente a partir do papel operacional (users.role).
-- Deriva o rótulo humano do papel e os domínios das áreas concedidas. nivel default 'ver' (único em uso).
CREATE OR REPLACE FUNCTION public.fn_provisionar_user_scope(
  p_user uuid, p_company uuid, p_role text, p_areas text[] DEFAULT NULL,
  p_nivel text DEFAULT 'ver', p_papel_rotulo text DEFAULT NULL, p_org_unidade uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rotulo text; v_dominios text[]; v_org uuid;
BEGIN
  -- org_unidade da empresa (NOT NULL no user_scope). Deriva: unidade já usada pela empresa (padrão
  -- estabelecido) → 1ª unidade não-raiz → qualquer ativa. Empresa SEM árvore org → user_scope não se
  -- aplica (RD-51: não forçar). O conceito é industrial/org-estruturado.
  v_org := COALESCE(
    p_org_unidade,
    (SELECT s.org_unidade_id FROM public.user_scope s WHERE s.company_id = p_company AND s.org_unidade_id IS NOT NULL
       GROUP BY s.org_unidade_id ORDER BY count(*) DESC LIMIT 1),
    (SELECT o.id FROM public.org_unidade o WHERE o.company_id = p_company AND o.ativo AND o.parent_id IS NOT NULL
       ORDER BY o.ordem NULLS LAST, o.criado_em LIMIT 1),
    (SELECT o.id FROM public.org_unidade o WHERE o.company_id = p_company AND o.ativo
       ORDER BY o.ordem NULLS LAST, o.criado_em LIMIT 1)
  );
  IF v_org IS NULL THEN RETURN; END IF;  -- empresa sem estrutura org → user_scope não aplicável

  v_rotulo := COALESCE(NULLIF(btrim(coalesce(p_papel_rotulo,'')), ''), CASE lower(coalesce(p_role,''))
    WHEN 'rh_industrial'   THEN 'RH'
    WHEN 'sst'             THEN 'Técnico Seg. Trabalho'
    WHEN 'gerente_planta'  THEN 'Gerente de Planta'
    WHEN 'gerente_processo' THEN 'Gerente de Processo'
    WHEN 'supervisor_turno' THEN 'Supervisor de Turno'
    WHEN 'operador'        THEN 'Operador'
    WHEN 'diretor_area'    THEN 'Diretor de Área'
    WHEN 'operacional'     THEN 'Operacional'
    ELSE initcap(replace(coalesce(NULLIF(p_role,''),'—'),'_',' ')) END);
  v_dominios := COALESCE(p_areas, (SELECT areas_allowed FROM public.user_areas_allowed WHERE user_id = p_user));

  INSERT INTO public.user_scope (user_id, company_id, org_unidade_id, nivel, papel_rotulo, dominios, ativo, criado_em)
  VALUES (p_user, p_company, v_org, COALESCE(NULLIF(p_nivel,''),'ver'), v_rotulo, COALESCE(v_dominios, '{}'::text[]), true, now())
  ON CONFLICT (user_id, company_id) DO UPDATE
    SET nivel = EXCLUDED.nivel, papel_rotulo = EXCLUDED.papel_rotulo, dominios = EXCLUDED.dominios, ativo = true;
END $$;

-- BACKFILL · todo usuário com vínculo ativo (tenant_user_roles) mas SEM user_scope naquela empresa.
-- Deriva do que já existe (users.role → rótulo; user_areas_allowed → domínios). Começa pelo rh2 e roda p/ todos.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tur.user_id, tur.company_id, u.role
    FROM public.tenant_user_roles tur
    JOIN public.users u ON u.id = tur.user_id
    WHERE tur.is_active
      AND NOT EXISTS (SELECT 1 FROM public.user_scope s WHERE s.user_id = tur.user_id AND s.company_id = tur.company_id)
  LOOP
    PERFORM public.fn_provisionar_user_scope(r.user_id, r.company_id, r.role);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.fn_provisionar_user_scope(uuid, uuid, text, text[], text, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_provisionar_user_scope(uuid, uuid, text, text[], text, text, uuid) TO authenticated;
