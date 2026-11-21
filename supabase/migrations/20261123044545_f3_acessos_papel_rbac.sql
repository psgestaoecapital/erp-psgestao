-- F3 TELA DE ACESSOS — SELETOR DE FUNÇÃO (papel RBAC) (emergência LGPD/acesso)
-- Mensagens eng_chefe: c910e458 (fatia F3) + complementos 14fdc862 (Vendedor), 54babd3a / 952727d5 (TI/Suporte, item-level).
--
-- A F1 (menu por papel) e a F2 (bloqueio de rota) JÁ leem user_scope.papel_slug. Faltava a TELA
-- (/dashboard/admin/acessos) deixar o gestor ESCOLHER a função: hoje só há "nível" e "papel de gestão".
-- Esta migration adiciona DUAS RPCs (aditivas) para a tela:
--   * fn_acessos_papeis_rbac(empresa)      -> LEITURA: funções RBAC disponíveis p/ a vertical da empresa
--                                             (com "o que cada função vê": seções + itens) + papel atual de cada pessoa.
--   * fn_acessos_definir_papel_rbac(...)   -> ESCRITA (sensível): grava/limpa user_scope.papel_slug, fail-closed.
--
-- Princípios:
--   * Guarda: só quem fn_acessos_pode_gerir(empresa) = true (mesma trava das demais RPCs da tela).
--   * Fonte única (RD-71): a função decide o que a pessoa VÊ via papel_slug — a MESMA coluna que F1/F2 já usam.
--   * RD-97: papel em branco => limpa papel_slug => comportamento atual (nível manda, nada muda).
--   * Fail-closed: função inexistente/inativa ou de vertical não contratada => recusa, não grava.
--   * Aditiva: NENHUMA função existente é alterada; as 11 guardas RD-91 ficam intactas. Não toca dado de cliente.
--   * A ÁREA/SETOR de um supervisor/gerente continua pelo campo "Áreas" que já existe na tela (user_areas_allowed);
--     o parâmetro p_area fica reservado para uma fatia futura (F3-B) e por ora não escreve escopo de área.

-- 1) LEITURA — funções RBAC da empresa + o que cada uma vê + papel atual por usuário.
CREATE OR REPLACE FUNCTION public.fn_acessos_papeis_rbac(p_company_id uuid)
RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result    jsonb;
  v_verticais text[];
BEGIN
  IF NOT public.fn_acessos_pode_gerir(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerir acessos desta empresa';
  END IF;

  -- Vertical(ais) RBAC da empresa a partir das áreas contratadas (mapa estável; nomes que já coincidem caem no ELSE).
  SELECT COALESCE(array_agg(DISTINCT v), '{}')
    INTO v_verticais
  FROM (
    SELECT CASE s.area_slug
             WHEN 'industrial' THEN 'industria'
             WHEN 'compliance' THEN 'industria'
             WHEN 'pm'  THEN 'pm'
             WHEN 'crm' THEN 'crm'
             WHEN 'hub' THEN 'hub'
             ELSE s.area_slug
           END AS v
    FROM public.fn_empresa_areas_status(p_company_id) s
    WHERE s.habilitada
  ) m
  WHERE v IN ('industria','pm','crm','hub');

  SELECT jsonb_build_object(
    'verticais', to_jsonb(v_verticais),
    'papeis', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'slug',   p.slug,
        'nome',   p.nome,
        'area',   p.area,
        'camada', p.camada,
        'secoes', COALESCE((
          SELECT jsonb_agg(DISTINCT CASE a.subgrupo
                   WHEN 'inicio'            THEN 'Início'
                   WHEN 'financeiro'        THEN 'Financeiro'
                   WHEN 'administracao'     THEN 'Administração'
                   WHEN 'cadastros'         THEN 'Cadastros'
                   WHEN 'analises'          THEN 'Análises & Relatórios'
                   WHEN 'contratos_vendas'  THEN 'Contratos & Vendas'
                   WHEN 'docs_regulatorios' THEN 'Documentos Regulatórios'
                   WHEN 'controle_epis'     THEN 'Controle de EPIs'
                   ELSE initcap(replace(a.subgrupo, '_', ' '))
                 END)
          FROM public.rbac_papel_acesso a WHERE a.papel_slug = p.slug), '[]'::jsonb),
        'itens', COALESCE((
          SELECT jsonb_agg(mc.nome ORDER BY mc.nome)
          FROM public.rbac_papel_modulo rpm
          JOIN public.module_catalog mc ON mc.id = rpm.module_id
          WHERE rpm.papel_slug = p.slug), '[]'::jsonb)
      ) ORDER BY p.camada, p.nome)
      FROM public.rbac_papel p
      WHERE p.ativo = true AND p.vertical = ANY(v_verticais)
    ), '[]'::jsonb),
    'atuais', COALESCE((
      SELECT jsonb_object_agg(us.user_id::text, us.papel_slug)
      FROM public.user_scope us
      WHERE us.company_id = p_company_id AND us.ativo = true
        AND us.papel_slug IS NOT NULL AND us.papel_slug <> ''
    ), '{}'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END
$function$;

-- 2) ESCRITA (sensível) — grava/limpa user_scope.papel_slug. Fail-closed.
CREATE OR REPLACE FUNCTION public.fn_acessos_definir_papel_rbac(
  p_company_id uuid,
  p_user_id    uuid,
  p_papel_slug text,
  p_area       text DEFAULT NULL::text   -- reservado p/ F3-B (área de atuação); hoje não escreve escopo de área
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_slug      text := NULLIF(btrim(COALESCE(p_papel_slug, '')), '');
  v_vertical  text;
  v_verticais text[];
  v_n         int;
BEGIN
  IF NOT public.fn_acessos_pode_gerir(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissão para gerir acessos desta empresa.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_companies WHERE user_id = p_user_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Usuário não pertence a esta empresa.');
  END IF;

  -- Em branco => limpa (RD-97: volta ao comportamento atual, só o nível manda).
  IF v_slug IS NULL THEN
    UPDATE public.user_scope SET papel_slug = NULL
      WHERE user_id = p_user_id AND company_id = p_company_id;
    RETURN jsonb_build_object('ok', true, 'papel_slug', NULL);
  END IF;

  -- Função tem de existir e estar ativa.
  SELECT vertical INTO v_vertical FROM public.rbac_papel WHERE slug = v_slug AND ativo = true;
  IF v_vertical IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Função (papel) inexistente ou inativa: ' || v_slug);
  END IF;

  -- E pertencer à vertical contratada pela empresa (fail-closed).
  SELECT COALESCE(array_agg(DISTINCT v), '{}') INTO v_verticais
  FROM (
    SELECT CASE s.area_slug
             WHEN 'industrial' THEN 'industria' WHEN 'compliance' THEN 'industria'
             WHEN 'pm' THEN 'pm' WHEN 'crm' THEN 'crm' WHEN 'hub' THEN 'hub'
             ELSE s.area_slug END AS v
    FROM public.fn_empresa_areas_status(p_company_id) s WHERE s.habilitada) m
  WHERE v IN ('industria','pm','crm','hub');

  IF NOT (v_vertical = ANY(v_verticais)) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Função não pertence à vertical contratada pela empresa.');
  END IF;

  -- Grava no escopo existente; se o usuário ainda não tem escopo nesta empresa, provisiona o base e grava.
  UPDATE public.user_scope SET papel_slug = v_slug
    WHERE user_id = p_user_id AND company_id = p_company_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    PERFORM public.fn_provisionar_user_scope(
      p_user_id, p_company_id, (SELECT role FROM public.users WHERE id = p_user_id));
    UPDATE public.user_scope SET papel_slug = v_slug
      WHERE user_id = p_user_id AND company_id = p_company_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN
      RETURN jsonb_build_object('ok', false,
        'erro', 'Não foi possível criar o escopo do usuário (unidade organizacional ausente). Defina o nível/área primeiro e salve.');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'papel_slug', v_slug);
END
$function$;

-- Privilégios: authenticated + service_role; anon NÃO executa (mesmo padrão das demais RPCs da tela).
REVOKE ALL ON FUNCTION public.fn_acessos_papeis_rbac(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_acessos_papeis_rbac(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_acessos_definir_papel_rbac(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_acessos_definir_papel_rbac(uuid, uuid, text, text) TO authenticated, service_role;

-- RD-95: "?" do novo campo "Função (papel)" na tela de Acessos (idempotente).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
SELECT
  'acessos_funcao_papel', '/dashboard/admin/acessos', 'pessoa', 'Função (papel)',
  'Escolha a FUNÇÃO da pessoa na empresa (ex.: RH Industrial, Vendedor, TI / Suporte). Em branco = sem restrição por função — a pessoa vê o menu conforme o nível.',
  'A função decide QUAIS seções e itens do menu a pessoa enxerga e consegue abrir: fecha por função o acesso a Financeiro, Comercial, Administração etc. É fail-closed — abrir por URL uma tela fora da função mostra "Acesso restrito à sua função".',
  'RH Industrial → só Início + Recursos Humanos. Vendedor → só Comercial. TI / Suporte → Início + Conectores, Abastecimento e Notificações técnicas.',
  'Não confundir com "Papel na empresa (o que PODE GERIR)": a Função controla o que a pessoa VÊ. Deixar em branco mantém o acesso amplo do nível — escolha a função para restringir.',
  NULL, 10
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo WHERE chave = 'acessos_funcao_papel');
