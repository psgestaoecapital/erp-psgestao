-- PR-2 RBAC 2D: aplica user_scope confirmado (SST) + helper de setores visíveis do BI de Gente.
ALTER TABLE public.user_scope ADD COLUMN IF NOT EXISTS observacao text;

-- Técnico de Segurança do Trabalho (Frioeste): setor "Segurança do Trabalho" + ['sst','gente'].
-- Motivo legal: SST precisa de jornada p/ CAT + pausas térmicas NR-36 (frigorífico) + NR-17.
INSERT INTO public.user_scope (user_id, company_id, org_unidade_id, dominios, nivel, papel_rotulo, observacao)
SELECT '3b969c82-309a-4d30-82c2-fd3dd4e05269', '975365cc-9e5a-4251-9022-68c6bfde10d8',
       'a86da866-392c-4167-bf3d-76a04f5f46d9', ARRAY['sst','gente'], 'ver', 'Técnico Seg. Trabalho',
       'SST precisa de jornada p/ CAT + pausas térmicas NR-36 (frigorífico) + pausas regulares NR-17.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_scope
  WHERE user_id='3b969c82-309a-4d30-82c2-fd3dd4e05269'
    AND org_unidade_id='a86da866-392c-4167-bf3d-76a04f5f46d9'
);

-- Setores visíveis do usuário atual (auth.uid) pro domínio 'gente'. Bypass PS_ADMIN/OWNER.
CREATE OR REPLACE FUNCTION public.fn_bi_gente_setores_visiveis(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_bypass boolean; v_setores text[]; v_total int; v_n int;
BEGIN
  v_bypass := EXISTS (SELECT 1 FROM public.users WHERE id=v_uid AND system_role='PS_ADMIN')
    OR EXISTS (SELECT 1 FROM public.tenant_user_roles WHERE user_id=v_uid AND company_id=p_company_id AND role='CLIENT_OWNER' AND is_active);
  SELECT array_agg(o.nome ORDER BY o.nome) INTO v_setores
  FROM public.org_unidade o
  WHERE o.company_id=p_company_id AND o.tipo='setor' AND o.ativo
    AND public.fn_user_pode_ver(v_uid, o.id, 'gente');
  v_setores := COALESCE(v_setores, ARRAY[]::text[]);
  SELECT count(*) INTO v_total FROM public.org_unidade WHERE company_id=p_company_id AND tipo='setor' AND ativo;
  v_n := COALESCE(array_length(v_setores,1),0);
  RETURN jsonb_build_object('ve_tudo', (v_bypass OR (v_n>0 AND v_n>=v_total)), 'setores', to_jsonb(v_setores));
END;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_bi_gente_setores_visiveis(uuid) TO authenticated, service_role;

-- Menu: área Inteligência (best-effort; a rota funciona mesmo sem isso).
INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, descricao)
VALUES ('inteligencia','Inteligência','industrial','📊','/dashboard/inteligencia',50,true,
        'Análise de Dados / BI modular (hierárquico por escopo + domínio)')
ON CONFLICT (id) DO NOTHING;
