-- PDCA P&M · /dashboard/pm/planejamento — RD-98 p4: exclusão NÃO era rastreável
--
-- CAUSA-RAIZ (RD-38, provado no dado · DEMO Agência b0700000-0000-4000-a000-000000000002):
--   A exclusão era UPDATE direto no cliente (page.tsx:176 planejamento, :206 post) setando só excluido_em —
--   NUNCA excluido_por (coluna existe, ficava NULL) e sem audit_log_global. Contagem na tabela:
--   agency_planejamentos 2954 excluídos (2954 com excluido_por=NULL); agency_posts 1969 (1969 com NULL).
--
-- ESTA MIGRATION (ADITIVA — 2 funções NOVAS, nenhuma tabela/RLS alterada):
--   fn_pm_planejamento_excluir / fn_pm_post_excluir — SECURITY DEFINER, mesmo padrão de
--   fn_agency_briefing_excluir: exige auth.uid(), confere empresa (get_user_company_ids OR is_admin),
--   idempotente, soft-delete (excluido_em + excluido_por + updated_at) e grava audit_log_global.
--   A tela passa a chamar essas RPCs em vez do UPDATE direto. REVOKE anon; GRANT só authenticated/service_role.

CREATE OR REPLACE FUNCTION public.fn_pm_planejamento_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_titulo text; v_excl timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para excluir'); END IF;
  SELECT company_id, titulo, excluido_em INTO v_company, v_titulo, v_excl
    FROM public.agency_planejamentos WHERE id = p_id FOR UPDATE;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'planejamento_nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_excl IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'id', p_id, 'ja_excluido', true); END IF;  -- idempotente
  UPDATE public.agency_planejamentos
     SET excluido_em = now(), excluido_por = auth.uid(), updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_company, auth.uid(), 'agency_planejamentos', p_id, 'excluir',
            jsonb_build_object('excluido_em', null),
            jsonb_build_object('excluido_em', now(), 'titulo', v_titulo));
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_pm_post_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_assunto text; v_excl timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para excluir'); END IF;
  SELECT company_id, assunto, excluido_em INTO v_company, v_assunto, v_excl
    FROM public.agency_posts WHERE id = p_id FOR UPDATE;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'post_nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_excl IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'id', p_id, 'ja_excluido', true); END IF;  -- idempotente
  UPDATE public.agency_posts
     SET excluido_em = now(), excluido_por = auth.uid(), updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_company, auth.uid(), 'agency_posts', p_id, 'excluir',
            jsonb_build_object('excluido_em', null),
            jsonb_build_object('excluido_em', now(), 'assunto', v_assunto));
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_pm_planejamento_excluir(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_pm_post_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_planejamento_excluir(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_pm_post_excluir(uuid) TO authenticated, service_role;
