-- ============================================================
-- PS_ADMIN_CVM em TODOS os portões de acesso que hoje só reconhecem PS_ADMIN (pedido do CEO, 3x)
--
-- PS_ADMIN_CVM é papel de PLATAFORMA (o CEO trabalha nas 10 empresas com ele). Vários portões de acesso
-- ("é PS admin?" / "bypass total" / "é equipe PS?") checavam só system_role='PS_ADMIN' e deixavam o CVM
-- de fora — o CEO via menos do que devia. O #1349 corrigiu 2 (fila de suporte + aprovar). Faltavam 16.
--
-- Transformação (uniforme e AUDITÁVEL — não reescreve a lógica, só amplia o conjunto de papéis):
--   • gates    system_role = 'PS_ADMIN'                 -> system_role IN ('PS_ADMIN','PS_ADMIN_CVM')
--   • equipe   system_role IN ('PS_ADMIN','PS_SUPPORT') -> ... + 'PS_ADMIN_CVM'
--   • hardening p_role IN ('PS_ADMIN','PS_SUPPORT')      -> ... + 'PS_ADMIN_CVM'  (bloquear atribuir o papel CVM
--     via função de escopo-empresa — fn_owner_atribuir_usuario; fica MAIS restritivo, não menos)
--
-- Aplicado por lista EXPLÍCITA de funções (nada fora dela é tocado); se algum padrão não casar numa função
-- da lista, a migration FALHA (não deixa passar silenciosamente). Sem policies/views no mesmo caso (auditado).
-- A checagem lowercase 'ps_admin' (mapeamento de nível em fn_acessos_convidar_pessoa) NÃO é tocada (é valor,
-- não portão).
-- ============================================================
DO $$
DECLARE
  v_fns text[] := ARRAY[
    'fn_acessos_convidar_pessoa','fn_acessos_definir_papel_gestao','fn_acessos_pode_gerir',
    'fn_areas_menu_lateral','fn_bi_gente_setores_visiveis','fn_listar_areas_visiveis',
    'fn_owner_atribuir_usuario','fn_owner_pode_gerir_escopo','fn_ponto_infracoes',
    'fn_ramos_cobertura','fn_ramos_cobertura_modulos','fn_sugestao_confirmar',
    'fn_sugestao_mensagem_enviar','fn_user_pode_ver','fn_user_scope_arvore','fn_usuarios_da_empresa'
  ];
  r record; v_def text; v_new text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(v_fns)
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := v_def;
    v_new := replace(v_new, 'system_role=''PS_ADMIN''',   'system_role IN (''PS_ADMIN'',''PS_ADMIN_CVM'')');
    v_new := replace(v_new, 'system_role = ''PS_ADMIN''',  'system_role IN (''PS_ADMIN'',''PS_ADMIN_CVM'')');
    v_new := replace(v_new, 'system_role IN (''PS_ADMIN'',''PS_SUPPORT'')', 'system_role IN (''PS_ADMIN'',''PS_SUPPORT'',''PS_ADMIN_CVM'')');
    v_new := replace(v_new, 'p_role IN (''PS_ADMIN'',''PS_SUPPORT'')',       'p_role IN (''PS_ADMIN'',''PS_SUPPORT'',''PS_ADMIN_CVM'')');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'PS_ADMIN_CVM: nenhum portao PS_ADMIN casou em % — revisar antes de aplicar', r.proname;
    END IF;
    EXECUTE v_new;
  END LOOP;
END $$;
