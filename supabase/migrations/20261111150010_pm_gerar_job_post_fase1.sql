-- P&M · Gerar job pelo post (Fase 1, CEO 09/11, desenho aprovado pela Marciana).
-- Um fluxo só: post -> botão "Gerar job" -> job. Esta RPC NÃO insere job: ela leva o post para 'aprovado' (estado que
-- JÁ dispara trg_agency_post_validar), e é o gatilho que cria o job (com a guarda job_id IS NULL). Assim o job nasce do
-- mesmo caminho dos 2826 posts que já viraram job — sem segundo caminho de criação, sem risco de duplicata.
-- Não toca no CHECK de agency_posts.status nem no vocabulário de status (isso é a Fase 2, com revisor).
-- Acesso: SECURITY DEFINER com a mesma regra de agency_posts (empresa do usuário ou admin), FOR UPDATE contra clique duplo.
-- Idempotente: post que já tem job devolve o job existente. Fail-closed: se o gatilho não criar o job, desfaz tudo.

CREATE OR REPLACE FUNCTION public.fn_agency_post_gerar_job(p_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v public.agency_posts%ROWTYPE;
  v_job uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para gerar o job');
  END IF;

  SELECT * INTO v FROM public.agency_posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'post_nao_encontrado');
  END IF;
  IF NOT (v.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  IF v.excluido_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'post_na_lixeira');
  END IF;
  -- idempotente: o post já está ligado a um job (clique duplo, segunda aba, ou job criado antes)
  IF v.job_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'id', p_post_id, 'job_id', v.job_id, 'ja_existia', true);
  END IF;
  -- mesma exigência do gatilho, dita antes para o usuário entender o que falta
  IF v.servico_id IS NULL OR v.publicar_em IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'falta_peca_ou_data');
  END IF;

  -- o gatilho só cria o job na PASSAGEM para aprovado/publicado. Post já 'publicado' sem job (raro) passa por
  -- 'em_aprovacao' antes, para a passagem acontecer de novo.
  IF v.status IN ('aprovado', 'publicado') THEN
    UPDATE public.agency_posts SET status = 'em_aprovacao', updated_at = now() WHERE id = p_post_id;
  END IF;
  UPDATE public.agency_posts SET status = 'aprovado', updated_at = now() WHERE id = p_post_id;

  SELECT job_id INTO v_job FROM public.agency_posts WHERE id = p_post_id;
  IF v_job IS NULL THEN
    -- fail-closed: sem job não há "gerado". A exceção desfaz a mudança de status.
    RAISE EXCEPTION 'O job do post % não foi criado', p_post_id USING ERRCODE = '23514';
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', p_post_id, 'job_id', v_job, 'ja_existia', false);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_agency_post_gerar_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_post_gerar_job(uuid) TO authenticated, service_role;
