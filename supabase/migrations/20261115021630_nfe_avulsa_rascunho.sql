-- Chamado #6728 · NF-e avulsa: salvar como rascunho e perguntar ao sair sem emitir · Code: rodrigo-code
-- Pedido do Robson (Vianz): na tela "Emitir NF-e avulsa" (/dashboard/fiscal/nfe/remessa), ao sair/fechar
-- com uma nota preenchida e ainda NÃO emitida, poder salvar o que foi digitado como RASCUNHO, voltar
-- depois pela lista "Rascunhos" em Notas emitidas, continuar e emitir; ao emitir, o rascunho some.
--
-- ETAPA 1 (backend): tabela de rascunho + RPCs salvar/listar/excluir. ADITIVA e IDEMPOTENTE.
-- O rascunho é só o conteúdo digitado (payload jsonb), por EMPRESA e por USUÁRIO dono. NÃO gera título no
-- financeiro, NÃO movimenta estoque e NÃO consome numeração fiscal (é apenas um "scratch" do formulário).
-- RLS por company_id + dono (user_id = auth.uid()); sem policy permissiva; REVOKE anon.
-- A UI (prompt ao sair, aba Rascunhos, remover ao emitir) vem na ETAPA 2.

-- 1) Tabela de rascunho -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_nfe_avulsa_rascunho (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL DEFAULT auth.uid(),
  titulo        text,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.erp_nfe_avulsa_rascunho IS
  'Rascunhos da tela Emitir NF-e avulsa (#6728). Conteúdo digitado (payload) por empresa e usuário dono; não gera título, estoque nem numeração fiscal. Removido ao emitir.';

CREATE INDEX IF NOT EXISTS idx_nfe_avulsa_rascunho_company_user
  ON public.erp_nfe_avulsa_rascunho (company_id, user_id, atualizado_em DESC);

ALTER TABLE public.erp_nfe_avulsa_rascunho ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_nfe_avulsa_rascunho_rls ON public.erp_nfe_avulsa_rascunho;
CREATE POLICY erp_nfe_avulsa_rascunho_rls ON public.erp_nfe_avulsa_rascunho
  FOR ALL
  USING (((company_id IN (SELECT get_user_company_ids())) AND user_id = auth.uid()) OR is_admin())
  WITH CHECK (((company_id IN (SELECT get_user_company_ids())) AND user_id = auth.uid()) OR is_admin());

REVOKE ALL ON public.erp_nfe_avulsa_rascunho FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.erp_nfe_avulsa_rascunho TO authenticated;
GRANT ALL ON public.erp_nfe_avulsa_rascunho TO service_role;

-- 2) Salvar (upsert do dono) ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_nfe_avulsa_rascunho_salvar(
  p_company_id uuid, p_payload jsonb, p_titulo text DEFAULT NULL::text, p_rascunho_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF NOT ((p_company_id IN (SELECT get_user_company_ids())) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_payload IS NULL OR p_payload = '{}'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'rascunho_vazio'); END IF;

  IF p_rascunho_id IS NOT NULL THEN
    UPDATE public.erp_nfe_avulsa_rascunho
       SET payload = p_payload,
           titulo = COALESCE(NULLIF(btrim(p_titulo), ''), titulo),
           atualizado_em = now()
     WHERE id = p_rascunho_id
       AND company_id = p_company_id
       AND (user_id = v_uid OR is_admin())
     RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'rascunho_nao_encontrado'); END IF;
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'acao', 'atualizado');
  END IF;

  INSERT INTO public.erp_nfe_avulsa_rascunho (company_id, user_id, titulo, payload)
  VALUES (p_company_id, v_uid, NULLIF(btrim(p_titulo), ''), p_payload)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'acao', 'criado');
END $function$;

REVOKE ALL ON FUNCTION public.fn_nfe_avulsa_rascunho_salvar(uuid, jsonb, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nfe_avulsa_rascunho_salvar(uuid, jsonb, text, uuid) TO authenticated, service_role;

-- 3) Listar os rascunhos do dono na empresa ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_nfe_avulsa_rascunho_listar(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_rows jsonb;
BEGIN
  IF NOT ((p_company_id IN (SELECT get_user_company_ids())) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id, 'titulo', r.titulo,
           'criado_em', r.criado_em, 'atualizado_em', r.atualizado_em
         ) ORDER BY r.atualizado_em DESC), '[]'::jsonb)
    INTO v_rows
    FROM public.erp_nfe_avulsa_rascunho r
   WHERE r.company_id = p_company_id AND (r.user_id = v_uid OR is_admin());

  RETURN jsonb_build_object('ok', true, 'rascunhos', v_rows);
END $function$;

REVOKE ALL ON FUNCTION public.fn_nfe_avulsa_rascunho_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nfe_avulsa_rascunho_listar(uuid) TO authenticated, service_role;

-- 4) Abrir um rascunho (payload completo do dono) ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_nfe_avulsa_rascunho_abrir(p_rascunho_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_r record;
BEGIN
  SELECT * INTO v_r FROM public.erp_nfe_avulsa_rascunho WHERE id = p_rascunho_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'rascunho_nao_encontrado'); END IF;
  IF NOT (((v_r.company_id IN (SELECT get_user_company_ids())) AND v_r.user_id = v_uid) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_r.id, 'titulo', v_r.titulo,
    'payload', v_r.payload, 'atualizado_em', v_r.atualizado_em);
END $function$;

REVOKE ALL ON FUNCTION public.fn_nfe_avulsa_rascunho_abrir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nfe_avulsa_rascunho_abrir(uuid) TO authenticated, service_role;

-- 5) Excluir (dono) — usado pelo botão Excluir e ao emitir com sucesso ------------------------------
CREATE OR REPLACE FUNCTION public.fn_nfe_avulsa_rascunho_excluir(p_rascunho_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  DELETE FROM public.erp_nfe_avulsa_rascunho
   WHERE id = p_rascunho_id
     AND (((company_id IN (SELECT get_user_company_ids())) AND user_id = v_uid) OR is_admin())
   RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'rascunho_nao_encontrado'); END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_nfe_avulsa_rascunho_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nfe_avulsa_rascunho_excluir(uuid) TO authenticated, service_role;
