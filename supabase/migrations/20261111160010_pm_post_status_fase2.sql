-- P&M · Fase 2 do fluxo post/job (CEO 09/11, desenho corrigido pela Marciana).
-- Vocabulário do POST passa a ser o do JOB, na ordem: nao_iniciada (Não Iniciada), em_producao (Em Produção),
-- em_aprovacao (Em aprovação), concluida (Concluído), publicado (Publicado).
--
-- Mapeamento: rascunho -> nao_iniciada; aprovado -> em_producao (os posts aprovados têm job EM ANDAMENTO, não terminado);
-- em_aprovacao e publicado ficam.
--
-- Criação de job: SÓ pelo botão "Gerar job" (fn_agency_post_gerar_job). A RPC liga a flag de transação
-- agency.gerar_job e leva o post a nao_iniciada; o gatilho trg_agency_post_validar cria o job (único caminho) e o
-- post FICA em nao_iniciada — quem move para Em Produção é o designer. Mudar o status na tela não cria job.
--
-- Como as funções longas não são reescritas à mão: cada troca abaixo é um trecho EXATO do corpo vivo, feita com
-- replace() sobre pg_get_functiondef, e o bloco ABORTA se o trecho não ocorrer exatamente uma vez.
-- Sem histórico de status e sem medição por etapa (fica para a Fase 2-B).

-- 1) Gatilho: job só quando a RPC liga a flag; status de gatilho sai de aprovado/publicado.
DO $fase2_gatilho$
DECLARE d text; n int;
BEGIN
  d := pg_get_functiondef('public.trg_agency_post_validar'::regproc);

  n := (length(d) - length(replace(d, $o$  IF NEW.status IN ('aprovado', 'publicado') AND (NEW.servico_id IS NULL OR NEW.publicar_em IS NULL) THEN$o$, ''))) / length($o$  IF NEW.status IN ('aprovado', 'publicado') AND (NEW.servico_id IS NULL OR NEW.publicar_em IS NULL) THEN$o$);
  IF n <> 1 THEN RAISE EXCEPTION 'fase2: trecho de peça/data do gatilho ocorre % vez(es)', n; END IF;
  d := replace(d, $o$  IF NEW.status IN ('aprovado', 'publicado') AND (NEW.servico_id IS NULL OR NEW.publicar_em IS NULL) THEN$o$,
                  $n$  IF NEW.status IN ('em_producao', 'concluida', 'publicado') AND (NEW.servico_id IS NULL OR NEW.publicar_em IS NULL) THEN$n$);

  n := (length(d) - length(replace(d, $o$  -- aprovado → job (só na passagem para aprovado; o job nunca é apagado por aqui)$o$, ''))) / length($o$  -- aprovado → job (só na passagem para aprovado; o job nunca é apagado por aqui)$o$);
  IF n <> 1 THEN RAISE EXCEPTION 'fase2: comentário do gatilho ocorre % vez(es)', n; END IF;
  d := replace(d, $o$  -- aprovado → job (só na passagem para aprovado; o job nunca é apagado por aqui)$o$,
                  $n$  -- job só quando a RPC Gerar job liga agency.gerar_job (Fase 2: o post fica em nao_iniciada)$n$);

  n := (length(d) - length(replace(d, $o$  IF NEW.status IN ('aprovado', 'publicado') AND NEW.job_id IS NULL AND NEW.excluido_em IS NULL
     AND (TG_OP = 'INSERT' OR v_old_status NOT IN ('aprovado', 'publicado')) THEN$o$, ''))) / length($o$  IF NEW.status IN ('aprovado', 'publicado') AND NEW.job_id IS NULL AND NEW.excluido_em IS NULL
     AND (TG_OP = 'INSERT' OR v_old_status NOT IN ('aprovado', 'publicado')) THEN$o$);
  IF n <> 1 THEN RAISE EXCEPTION 'fase2: condição de criação do job ocorre % vez(es)', n; END IF;
  d := replace(d, $o$  IF NEW.status IN ('aprovado', 'publicado') AND NEW.job_id IS NULL AND NEW.excluido_em IS NULL
     AND (TG_OP = 'INSERT' OR v_old_status NOT IN ('aprovado', 'publicado')) THEN$o$,
                  $n$  IF current_setting('agency.gerar_job', true) = '1' AND NEW.status = 'nao_iniciada' AND NEW.job_id IS NULL AND NEW.excluido_em IS NULL THEN$n$);

  EXECUTE d;
END
$fase2_gatilho$;

-- 2) Planejamento gerado do fee: posts nascem em nao_iniciada (o planejamento continua com o vocabulário dele).
DO $fase2_fee$
DECLARE d text; n int; antigo text := $o$it.servico_id, 'rascunho', v_ordem);$o$;
BEGIN
  d := pg_get_functiondef('public.fn_pm_planejamento_do_fee'::regproc);
  n := (length(d) - length(replace(d, antigo, ''))) / length(antigo);
  IF n <> 1 THEN RAISE EXCEPTION 'fase2: insert de posts do fee ocorre % vez(es)', n; END IF;
  EXECUTE replace(d, antigo, $n$it.servico_id, 'nao_iniciada', v_ordem);$n$);
END
$fase2_fee$;

-- 3) Demo: a demonstração usa o vocabulário novo e cria os jobs pelo mesmo caminho do botão.
DO $fase2_demo$
DECLARE
  d text; n int; i int;
  pares text[][] := ARRAY[
    ARRAY[$o$'aprovado', 'G',$o$, $n$'em_producao', 'G',$n$, '2'],
    ARRAY[$o$'aprovado', 'R',$o$, $n$'em_producao', 'R',$n$, '3'],
    ARRAY[$o$'rascunho', NULL,$o$, $n$'nao_iniciada', NULL,$n$, '3'],
    ARRAY[$o$CASE WHEN v_srv IS NULL THEN 'rascunho' ELSE s.st END$o$, $n$CASE WHEN v_srv IS NULL THEN 'nao_iniciada' ELSE s.st END$n$, '1'],
    ARRAY[$o$status = CASE WHEN v_srv IS NULL THEN 'rascunho' WHEN s.st IN ('aprovado', 'publicado') AND v_job IS NULL THEN 'rascunho' ELSE s.st END$o$, $n$status = CASE WHEN v_srv IS NULL THEN 'nao_iniciada' ELSE s.st END$n$, '1'],
    ARRAY[$o$      IF v_srv IS NOT NULL AND s.st IN ('aprovado', 'publicado') AND v_job IS NULL THEN
        UPDATE agency_posts SET status = s.st WHERE id = v_post;      -- passa por aprovado de novo: o gatilho cria o job
      END IF;
$o$, $n$$n$, '1'],
    ARRAY[$o$  SELECT count(*) INTO v_jobs FROM agency_posts WHERE planejamento_id = ANY (v_pl) AND job_id IS NOT NULL AND excluido_em IS NULL;$o$,
          $n$  -- Fase 2: posts que devem estar em produção/publicados e ainda sem job ganham o job pelo botão (flag + nao_iniciada)
  FOR r IN SELECT id, status FROM agency_posts WHERE planejamento_id = ANY (v_pl) AND excluido_em IS NULL AND job_id IS NULL AND servico_id IS NOT NULL AND status IN ('em_producao', 'publicado') LOOP
    PERFORM set_config('agency.gerar_job', '1', true);
    UPDATE agency_posts SET status = 'nao_iniciada' WHERE id = r.id;
    PERFORM set_config('agency.gerar_job', '', true);
    UPDATE agency_posts SET status = r.status WHERE id = r.id;
  END LOOP;
  SELECT count(*) INTO v_jobs FROM agency_posts WHERE planejamento_id = ANY (v_pl) AND job_id IS NOT NULL AND excluido_em IS NULL;$n$, '1']
  ];
BEGIN
  d := pg_get_functiondef('public.fn_demo_seed_pm_social'::regproc);
  FOR i IN 1 .. array_length(pares, 1) LOOP
    n := (length(d) - length(replace(d, pares[i][1], ''))) / length(pares[i][1]);
    IF n <> pares[i][3]::int THEN RAISE EXCEPTION 'fase2: demo, trecho % ocorre % vez(es), esperado %', i, n, pares[i][3]; END IF;
    d := replace(d, pares[i][1], pares[i][2]);
  END LOOP;
  EXECUTE d;
END
$fase2_demo$;

-- 4) RPC do botão: liga a flag, leva o post a nao_iniciada (o gatilho cria o job), e o post FICA em nao_iniciada.
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
  -- idempotente: clique duplo, segunda aba, ou job criado antes
  IF v.job_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'id', p_post_id, 'job_id', v.job_id, 'ja_existia', true);
  END IF;
  IF v.servico_id IS NULL OR v.publicar_em IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'falta_peca_ou_data');
  END IF;
  -- só antes da produção: depois que o designer começou, gerar job não se aplica
  IF v.status NOT IN ('nao_iniciada', 'em_aprovacao') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'post_ja_em_andamento');
  END IF;

  PERFORM set_config('agency.gerar_job', '1', true);
  UPDATE public.agency_posts SET status = 'nao_iniciada', updated_at = now() WHERE id = p_post_id;
  PERFORM set_config('agency.gerar_job', '', true);

  SELECT job_id INTO v_job FROM public.agency_posts WHERE id = p_post_id;
  IF v_job IS NULL THEN
    -- fail-closed: sem job não há "gerado". A exceção desfaz a mudança.
    RAISE EXCEPTION 'O job do post % não foi criado', p_post_id USING ERRCODE = '23514';
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', p_post_id, 'job_id', v_job, 'ja_existia', false);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_agency_post_gerar_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_post_gerar_job(uuid) TO authenticated, service_role;

-- 5) Vocabulário novo no CHECK, com migração dos dados (aditivo na ordem: solta o antigo, migra, põe o novo).
ALTER TABLE public.agency_posts DROP CONSTRAINT agency_posts_status_check;
ALTER TABLE public.agency_posts ALTER COLUMN status SET DEFAULT 'nao_iniciada';   -- insert sem status não pode cair em 'rascunho' (fora do vocabulário novo)
UPDATE public.agency_posts SET status = 'nao_iniciada' WHERE status = 'rascunho';
UPDATE public.agency_posts SET status = 'em_producao' WHERE status = 'aprovado';
ALTER TABLE public.agency_posts ADD CONSTRAINT agency_posts_status_check
  CHECK (status = ANY (ARRAY['nao_iniciada'::text, 'em_producao'::text, 'em_aprovacao'::text, 'concluida'::text, 'publicado'::text]));
