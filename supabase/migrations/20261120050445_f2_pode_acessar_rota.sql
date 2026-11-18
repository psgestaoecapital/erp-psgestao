-- F2 BLOQUEIO DE ROTA POR PAPEL (emergência LGPD/acesso — msg eng_chefe c910e458, fatia F2)
-- Complementa a F1 (menu por papel). A F1 ESCONDE do menu as seções que o papel não libera,
-- mas abrir a tela pela URL ainda renderiza a seção (o vazamento continua para quem digita a rota).
-- A F2 fecha isso no servidor, com a MESMA regra do menu (RD-71: uma fonte de verdade):
--   fn_pode_acessar_rota(rota, area, empresa, usuário) = a rota só é liberada se o MÓDULO dono
--   dela está no menu autorizado do papel — ou seja, em fn_modulos_sidebar_por_area(...).
--
-- Princípios:
--   * Fail-closed: papel ativo + rota que mapeia a um módulo FORA do menu autorizado => FALSE (bloqueia).
--   * RD-97 (no-op para quem não tem papel): usuário SEM papel ativo => TRUE (nada muda).
--   * Equipe PS (system_role PS_ADMIN/PS_ADMIN_CVM) => TRUE (vê tudo).
--   * RD-51 (nunca tela vazia): raiz do dashboard, raiz da área e seção INÍCIO sempre liberadas.
--   * Rota que não mapeia a nenhum módulo da área (página órfã/detalhe sem módulo próprio) => TRUE
--     (não inventa bloqueio; o dado em si segue protegido pela RLS/funções de guarda RD-91, intocadas).
--   * O módulo-raiz da área (landing, id = área) nunca é âncora de PREFIXO (evita falso-positivo em
--     subpáginas /dashboard/<area>/... sem módulo próprio); só casa EXATO, e a raiz já é liberada acima.
--
-- Aditiva (nova função, nenhuma função existente é tocada; as 11 guardas RD-91 ficam intactas).

CREATE OR REPLACE FUNCTION public.fn_pode_acessar_rota(
  p_rota text,
  p_area_id text DEFAULT NULL::text,
  p_company_id uuid DEFAULT NULL::uuid,
  p_user_id uuid DEFAULT NULL::uuid
) RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_papel_slug text;
  v_rota_base  text;
  v_area       text;
  v_rota_raiz  text;
  v_mod        text;
  v_sub        text;
BEGIN
  p_user_id := COALESCE(p_user_id, auth.uid());

  -- Sem usuário resolvido: não há papel para avaliar => não bloqueia (RD-97). A autenticação
  -- da tela/da RLS continua valendo por baixo; esta função só decide o gate POR PAPEL.
  IF p_user_id IS NULL THEN RETURN true; END IF;

  -- Equipe PS vê tudo.
  IF EXISTS (SELECT 1 FROM public.users u
             WHERE u.id = p_user_id AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM')) THEN
    RETURN true;
  END IF;

  -- Normaliza a rota: remove querystring, âncora e barra(s) final(is).
  v_rota_base := split_part(split_part(COALESCE(p_rota,''), '?', 1), '#', 1);
  v_rota_base := regexp_replace(v_rota_base, '/+$', '');
  IF v_rota_base = '' THEN v_rota_base := '/dashboard'; END IF;

  -- RD-51: a raiz do dashboard é sempre liberada.
  IF v_rota_base = '/dashboard' THEN RETURN true; END IF;

  -- Papel ativo do usuário nesta empresa (idêntico à F1, uma fonte de verdade).
  IF p_company_id IS NOT NULL THEN
    SELECT us.papel_slug INTO v_papel_slug
    FROM public.user_scope us
    WHERE us.user_id = p_user_id AND us.company_id = p_company_id
      AND us.ativo = true AND us.papel_slug IS NOT NULL AND us.papel_slug <> ''
    LIMIT 1;
  END IF;

  -- Sem papel definido => RD-97: comportamento atual, nada muda (libera).
  IF v_papel_slug IS NULL THEN RETURN true; END IF;

  -- Área: a do parâmetro (o menu já navega com ?area=<slug>); normaliza hífen->underscore
  -- como a RPC do menu. Sem área não dá para situar a rota no menu => não bloqueia.
  v_area := NULLIF(replace(COALESCE(p_area_id,''), '-', '_'), '');
  IF v_area IS NULL THEN RETURN true; END IF;

  -- RD-51: a raiz da área (home/atalhos) é sempre liberada, qualquer que seja o papel.
  SELECT a.rota_raiz INTO v_rota_raiz FROM public.area_menu_config a WHERE a.id = v_area;
  IF v_rota_raiz IS NOT NULL AND v_rota_base = regexp_replace(split_part(v_rota_raiz,'?',1), '/+$', '') THEN
    RETURN true;
  END IF;

  -- Mapear a rota ao MÓDULO dono: maior rota (igual ou prefixo) entre TODOS os módulos da área
  -- (sem gate), EXCLUINDO o módulo-raiz (id = área) como âncora de prefixo — ele só casa EXATO.
  WITH area_mods AS (
    SELECT mc.id,
           mc.subgrupo,
           regexp_replace(split_part(split_part(COALESCE(mc.rota,''), '?', 1), '#', 1), '/+$', '') AS rbase
    FROM public.module_catalog mc
    WHERE mc.ativo = true AND mc.legacy = false
      AND ( mc.grupo = v_area
         OR (mc.is_shared = true AND mc.surface_in_groups @> ARRAY[v_area]::text[]) )
  )
  SELECT am.id, am.subgrupo INTO v_mod, v_sub
  FROM area_mods am
  WHERE am.rbase <> ''
    AND ( v_rota_base = am.rbase
       OR (am.id <> v_area AND v_rota_base LIKE am.rbase || '/%') )
  ORDER BY length(am.rbase) DESC
  LIMIT 1;

  -- Rota não mapeia a nenhum módulo da área => não inventa bloqueio (RD-51; RLS cobre o dado).
  IF v_mod IS NULL THEN RETURN true; END IF;

  -- Seção INÍCIO sempre liberada.
  IF v_sub = 'inicio' THEN RETURN true; END IF;

  -- Liberado SSE o módulo dono da rota está no menu AUTORIZADO do papel (mesma função do menu).
  -- É aqui que o item-level (rbac_papel_modulo, caso TI/Suporte dentro de Administração) é
  -- respeitado automaticamente: só os módulos realmente liberados aparecem na RPC.
  RETURN EXISTS (
    SELECT 1
    FROM public.fn_modulos_sidebar_por_area(v_area, p_company_id, p_user_id) m
    WHERE m.modulo_id = v_mod
  );
END
$function$;

-- Privilégios: mesmo padrão das funções de menu (authenticated + service_role; anon NÃO executa).
REVOKE ALL ON FUNCTION public.fn_pode_acessar_rota(text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pode_acessar_rota(text, text, uuid, uuid) TO authenticated, service_role;
