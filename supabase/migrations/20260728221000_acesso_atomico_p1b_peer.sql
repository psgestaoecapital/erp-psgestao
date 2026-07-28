-- Provisionamento de acesso · Parte 1b — consistência por PAPEL: um usuário novo espelha um COLEGA do
-- mesmo papel na empresa (org_unidade, nível, rótulo, domínios). É o que o CEO pediu: "mesmo nível → mesmas
-- telas". Deriva-do-colega primeiro; só cai no mapa/áreas quando não há colega. Preserva os originais.

CREATE OR REPLACE FUNCTION public.fn_provisionar_user_scope(
  p_user uuid, p_company uuid, p_role text, p_areas text[] DEFAULT NULL,
  p_nivel text DEFAULT NULL, p_papel_rotulo text DEFAULT NULL, p_org_unidade uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rotulo text; v_dominios text[]; v_org uuid; v_nivel text;
        v_peer public.user_scope%rowtype;
BEGIN
  -- colega do MESMO papel na mesma empresa (fonte de verdade da "cara" do papel)
  SELECT s.* INTO v_peer
  FROM public.user_scope s JOIN public.users u2 ON u2.id = s.user_id
  WHERE s.company_id = p_company AND lower(coalesce(u2.role,'')) = lower(coalesce(p_role,''))
    AND s.user_id <> p_user AND s.ativo
  ORDER BY s.criado_em LIMIT 1;

  v_org := COALESCE(
    p_org_unidade, v_peer.org_unidade_id,
    (SELECT s.org_unidade_id FROM public.user_scope s WHERE s.company_id = p_company AND s.org_unidade_id IS NOT NULL
       GROUP BY s.org_unidade_id ORDER BY count(*) DESC LIMIT 1),
    (SELECT o.id FROM public.org_unidade o WHERE o.company_id = p_company AND o.ativo AND o.parent_id IS NOT NULL
       ORDER BY o.ordem NULLS LAST, o.criado_em LIMIT 1),
    (SELECT o.id FROM public.org_unidade o WHERE o.company_id = p_company AND o.ativo
       ORDER BY o.ordem NULLS LAST, o.criado_em LIMIT 1)
  );
  IF v_org IS NULL THEN RETURN; END IF;  -- empresa sem estrutura org → user_scope não aplicável

  v_nivel  := COALESCE(NULLIF(btrim(coalesce(p_nivel,'')),''), v_peer.nivel, 'ver');
  v_rotulo := COALESCE(NULLIF(btrim(coalesce(p_papel_rotulo,'')),''), v_peer.papel_rotulo, CASE lower(coalesce(p_role,''))
    WHEN 'rh_industrial'    THEN 'RH'
    WHEN 'sst'              THEN 'Técnico Seg. Trabalho'
    WHEN 'gerente_planta'   THEN 'Gerente de Planta'
    WHEN 'gerente_processo' THEN 'Gerente de Processo'
    WHEN 'supervisor_turno' THEN 'Supervisor de Turno'
    WHEN 'operador'         THEN 'Operador'
    WHEN 'diretor_area'     THEN 'Diretor de Área'
    WHEN 'operacional'      THEN 'Operacional'
    ELSE initcap(replace(coalesce(NULLIF(p_role,''),'—'),'_',' ')) END);
  v_dominios := COALESCE(p_areas, v_peer.dominios, (SELECT areas_allowed FROM public.user_areas_allowed WHERE user_id = p_user));

  INSERT INTO public.user_scope (user_id, company_id, org_unidade_id, nivel, papel_rotulo, dominios, ativo, criado_em)
  VALUES (p_user, p_company, v_org, v_nivel, v_rotulo, COALESCE(v_dominios, '{}'::text[]), true, now())
  ON CONFLICT (user_id, company_id) DO UPDATE
    SET org_unidade_id = EXCLUDED.org_unidade_id, nivel = EXCLUDED.nivel,
        papel_rotulo = EXCLUDED.papel_rotulo, dominios = EXCLUDED.dominios, ativo = true;
END $$;

-- re-deriva SÓ os que foram backfillados agora (não estavam no backup) — espelham o colega original.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT s.user_id, s.company_id, u.role
    FROM public.user_scope s JOIN public.users u ON u.id = s.user_id
    WHERE NOT EXISTS (SELECT 1 FROM public._bkp_user_scope_20260728 b WHERE b.user_id = s.user_id AND b.company_id = s.company_id)
  LOOP
    PERFORM public.fn_provisionar_user_scope(r.user_id, r.company_id, r.role);
  END LOOP;
END $$;
