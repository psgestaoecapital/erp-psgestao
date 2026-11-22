-- PS EHS · M2 (GRO/PGR, NR-1) — Matriz de Risco por Setor: exclusão RASTREÁVEL (RD-98 p4).
-- PDCA aud8 90/95 (foto 20/11, DEMO Indústria Modelo …005): a tela fazia DELETE FÍSICO do registro de
-- risco (prod_setor_risco) direto pelo client, sem quem/soft-delete/audit. prod_setor_risco é a base do
-- inventário de riscos (GRO) e do PGR — um risco legal não pode sumir sem rastro.
--
-- Esta migration (ADITIVA):
--   1) acrescenta colunas de soft-delete (deleted_at/deleted_by), nullable — nenhum dado alterado;
--   2) troca a policy FOR ALL por uma policy de SELECT (mesma regra de empresa): o client lê, mas NÃO
--      escreve direto — inclusão/alteração/exclusão passam a ser só pelas RPCs guardadas abaixo;
--   3) cria 3 funções SECURITY DEFINER (guarda por empresa do usuário) que gravam em audit_log_global;
--      a exclusão é LÓGICA (soft-delete) — nunca DELETE físico de registro de PGR.
-- Único writer no front é a própria tela (src/app/dashboard/ehs/matriz/risco-setor/page.tsx); os seeds da
-- DEMO rodam em tempo de migration (bypass RLS), então o aperto da policy não os afeta. RD-52: arquivo em
-- supabase/migrations + PR acima da main. RD-96/RD-100: sem nome de terceiros.

-- ============================================================ 1) colunas de soft-delete (aditivas, nullable)
ALTER TABLE public.prod_setor_risco ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.prod_setor_risco ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- ============================================================ 2) policy: só SELECT pelo client (escrita via RPC)
DROP POLICY IF EXISTS prod_setor_risco_rw ON public.prod_setor_risco;
DROP POLICY IF EXISTS prod_setor_risco_select ON public.prod_setor_risco;
CREATE POLICY prod_setor_risco_select ON public.prod_setor_risco
  FOR SELECT
  USING ((company_id IN (SELECT public.get_user_company_ids())) OR public.is_admin());

-- ============================================================ 3a) incluir risco do setor (guardada + audit)
CREATE OR REPLACE FUNCTION public.fn_prod_setor_risco_incluir(
  p_setor_id uuid, p_tipo text, p_descricao text, p_grau text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid;
  v_id   uuid;
BEGIN
  SELECT company_id INTO v_comp FROM public.prod_setor WHERE id = p_setor_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'setor_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  IF p_tipo IS NULL OR btrim(p_tipo) = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'tipo_obrigatorio'); END IF;
  IF p_descricao IS NULL OR btrim(p_descricao) = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'descricao_obrigatoria'); END IF;

  INSERT INTO public.prod_setor_risco (company_id, setor_id, tipo, descricao, grau)
  VALUES (v_comp, p_setor_id, lower(btrim(p_tipo)), btrim(p_descricao), NULLIF(lower(btrim(coalesce(p_grau,''))), ''))
  RETURNING id INTO v_id;

  INSERT INTO public.audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_novo)
  VALUES (v_comp, auth.uid(), auth.jwt() ->> 'email', 'prod_setor_risco', v_id::text, 'prod_setor_risco_incluir',
          jsonb_build_object('setor_id', p_setor_id, 'tipo', lower(btrim(p_tipo)), 'descricao', btrim(p_descricao), 'grau', NULLIF(lower(btrim(coalesce(p_grau,''))), '')));

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $function$;

-- ============================================================ 3b) alterar risco do setor (guardada + audit)
CREATE OR REPLACE FUNCTION public.fn_prod_setor_risco_alterar(
  p_id uuid, p_setor_id uuid, p_tipo text, p_descricao text, p_grau text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp       uuid;
  v_comp_novo  uuid;
  v_antes      jsonb;
BEGIN
  SELECT company_id, jsonb_build_object('setor_id', setor_id, 'tipo', tipo, 'descricao', descricao, 'grau', grau)
    INTO v_comp, v_antes
    FROM public.prod_setor_risco
   WHERE id = p_id AND deleted_at IS NULL;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  -- o setor destino tem de ser da MESMA empresa do registro (nunca mover risco para empresa de terceiro)
  SELECT company_id INTO v_comp_novo FROM public.prod_setor WHERE id = p_setor_id;
  IF v_comp_novo IS NULL OR v_comp_novo <> v_comp THEN RETURN jsonb_build_object('ok', false, 'erro', 'setor_invalido'); END IF;
  IF p_tipo IS NULL OR btrim(p_tipo) = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'tipo_obrigatorio'); END IF;
  IF p_descricao IS NULL OR btrim(p_descricao) = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'descricao_obrigatoria'); END IF;

  UPDATE public.prod_setor_risco
     SET setor_id = p_setor_id, tipo = lower(btrim(p_tipo)), descricao = btrim(p_descricao),
         grau = NULLIF(lower(btrim(coalesce(p_grau,''))), '')
   WHERE id = p_id;

  INSERT INTO public.audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_comp, auth.uid(), auth.jwt() ->> 'email', 'prod_setor_risco', p_id::text, 'prod_setor_risco_alterar',
          v_antes,
          jsonb_build_object('setor_id', p_setor_id, 'tipo', lower(btrim(p_tipo)), 'descricao', btrim(p_descricao), 'grau', NULLIF(lower(btrim(coalesce(p_grau,''))), '')));

  RETURN jsonb_build_object('ok', true);
END; $function$;

-- ============================================================ 3c) excluir risco (LÓGICO) do setor (guardada + audit)
CREATE OR REPLACE FUNCTION public.fn_prod_setor_risco_excluir(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp  uuid;
  v_antes jsonb;
BEGIN
  SELECT company_id, jsonb_build_object('setor_id', setor_id, 'tipo', tipo, 'descricao', descricao, 'grau', grau)
    INTO v_comp, v_antes
    FROM public.prod_setor_risco
   WHERE id = p_id AND deleted_at IS NULL;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;  -- idempotente
  IF NOT (v_comp IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  UPDATE public.prod_setor_risco
     SET deleted_at = now(), deleted_by = auth.uid()
   WHERE id = p_id;

  INSERT INTO public.audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior)
  VALUES (v_comp, auth.uid(), auth.jwt() ->> 'email', 'prod_setor_risco', p_id::text, 'prod_setor_risco_excluir', v_antes);

  RETURN jsonb_build_object('ok', true);
END; $function$;

-- ============================================================ grants (REVOKE anon — RD segurança)
REVOKE ALL ON FUNCTION public.fn_prod_setor_risco_incluir(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_prod_setor_risco_alterar(uuid, uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_prod_setor_risco_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_setor_risco_incluir(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_prod_setor_risco_alterar(uuid, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_prod_setor_risco_excluir(uuid) TO authenticated;
