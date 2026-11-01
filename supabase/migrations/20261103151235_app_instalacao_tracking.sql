-- Hub de Projetos · /dashboard/projetos/instalar-app (App de campo do vendedor) · RD-98 pilar 3 + feature de tracking
-- PDCA auditor_pdca_1 (31/10): a tela estava 90/70/85 (VERMELHO) porque system_screens registrava 0 views/0 rpcs
-- (dado_bate_banco=false) e o auditor pediu "tracking de quantos usuários instalaram". Esta migration é ADITIVA:
-- cria a tabela de registro de instalação (uma linha por empresa+usuário+rota, idempotente) + 2 RPCs com guarda
-- (registrar e contar), RLS por empresa e REVOKE anon. NENHUMA tabela/policy/grant existente é alterada; nada de
-- dado de cliente é apagado. O componente <InstalarApp> passa a registrar a instalação (evento appinstalled /
-- prompt aceito) e a mostrar o indicador "pessoas que já instalaram" APENAS nas telas que optam por rastrear
-- (prop `rastrear`) — o Agro segue sem mudança de comportamento (não opta).

-- ── (1) tabela de registro de instalação (aditiva) ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_app_instalacao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  user_id       uuid,
  rota          text NOT NULL,
  area          text,
  plataforma    text,
  instalado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- uma linha por empresa+usuário+rota (reinstalar atualiza, NÃO soma de novo na contagem)
CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_app_instalacao_empresa_user_rota
  ON public.erp_app_instalacao (company_id, user_id, rota) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_erp_app_instalacao_empresa_rota
  ON public.erp_app_instalacao (company_id, rota);

ALTER TABLE public.erp_app_instalacao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_app_instalacao FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS erp_app_instalacao_empresa ON public.erp_app_instalacao;
CREATE POLICY erp_app_instalacao_empresa ON public.erp_app_instalacao FOR ALL TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
GRANT SELECT, INSERT, UPDATE ON public.erp_app_instalacao TO authenticated;
GRANT ALL ON public.erp_app_instalacao TO service_role;

COMMENT ON TABLE public.erp_app_instalacao IS
  'Registro de instalação do PWA por empresa/usuário/rota (tracking do "Instalar app"). Aditiva, RLS por empresa.';

-- ── (2) registrar a instalação (idempotente por empresa+usuário+rota) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_app_instalacao_registrar(
  p_company_id uuid, p_rota text, p_area text DEFAULT NULL, p_plataforma text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'sem_sessao'; END IF;
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF p_rota IS NULL OR length(btrim(p_rota)) = 0 THEN RAISE EXCEPTION 'rota_obrigatoria'; END IF;

  INSERT INTO public.erp_app_instalacao (company_id, user_id, rota, area, plataforma)
  VALUES (p_company_id, v_uid, p_rota, p_area, p_plataforma)
  ON CONFLICT (company_id, user_id, rota) WHERE user_id IS NOT NULL
  DO UPDATE SET area = COALESCE(EXCLUDED.area, public.erp_app_instalacao.area),
                plataforma = COALESCE(EXCLUDED.plataforma, public.erp_app_instalacao.plataforma),
                atualizado_em = now();
  RETURN jsonb_build_object('ok', true);
END $function$;
REVOKE ALL ON FUNCTION public.fn_app_instalacao_registrar(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_app_instalacao_registrar(uuid, text, text, text) TO authenticated;

-- ── (3) contagem de instalações da empresa nesta rota ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_app_instalacao_contagem(p_company_id uuid, p_rota text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_total int; v_meu boolean;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  SELECT count(DISTINCT user_id) INTO v_total
    FROM public.erp_app_instalacao
   WHERE company_id = p_company_id AND rota = p_rota AND user_id IS NOT NULL;
  v_meu := EXISTS (SELECT 1 FROM public.erp_app_instalacao
                    WHERE company_id = p_company_id AND rota = p_rota AND user_id = v_uid);
  RETURN jsonb_build_object('total', COALESCE(v_total, 0), 'meu', COALESCE(v_meu, false));
END $function$;
REVOKE ALL ON FUNCTION public.fn_app_instalacao_contagem(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_app_instalacao_contagem(uuid, text) TO authenticated;

-- ── (4) "?" (RD-95) do indicador de instalações, para as telas que optam por rastrear ─────────────────────────
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('projetos.instalar_app.instalacoes', '/dashboard/projetos/instalar-app', 'Instalar', 'Pessoas que instalaram',
   'Indicador automático (nada a preencher): conta quantas pessoas da sua empresa já registraram a instalação do app nesta tela.',
   'Acompanhar a adoção do app de campo pela equipe — quantos já instalaram no celular.',
   '"3 pessoas já instalaram" significa que 3 contas da sua empresa abriram e instalaram o app.',
   'Conta uma vez por pessoa: reinstalar ou trocar de aparelho não soma de novo.',
   'hub_construcao', 70, 'publicado')
ON CONFLICT (chave) DO NOTHING;
