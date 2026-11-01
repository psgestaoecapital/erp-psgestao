-- Chamado "sincronismo de status" · trava de coerência na ORIGEM (fn_sugestao_status).
--
-- Causa do resíduo (ver backfill 20261005170030): ao mover um chamado para um status NÃO concluído,
-- a função mantinha `concluido_em` e `confirmado_pelo_autor` da conclusão anterior — gerando linhas
-- inconsistentes (concluído/confirmado mas em 'em_analise'). Esta trava faz os campos acompanharem o
-- status: só 'concluida' pode ter `concluido_em` e `confirmado_pelo_autor` preservados; qualquer outro
-- status (reabertura, aguardando, recusada, arquivada…) zera os dois.
--
-- É CREATE OR REPLACE de função SECURITY DEFINER existente (guarda de acesso) — por isso vai com
-- revisao-eng-chefe. Definição lida VIVA com pg_get_functiondef antes de reescrever; muda APENAS as
-- duas linhas de `concluido_em`/`confirmado_pelo_autor` no UPDATE (resto idêntico ao vivo).
-- ACL preservada (igual ao vivo): authenticated + service_role; anon sem acesso.

CREATE OR REPLACE FUNCTION public.fn_sugestao_status(p_id uuid, p_novo text, p_user uuid, p_motivo text DEFAULT NULL::text, p_pr_numero integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_atual text;
BEGIN
  IF NOT (is_admin() OR fn_pode_ver_fila_suporte()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT status INTO v_atual FROM sugestoes WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'sugestao_nao_encontrada'); END IF;
  IF p_novo IS NULL OR NOT (p_novo = ANY (public.fn_sugestao_status_permitidos())) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status_invalido'); END IF;
  IF p_novo = 'recusada' AND COALESCE(trim(p_motivo),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'recusa_exige_motivo'); END IF;

  UPDATE sugestoes SET
    status = p_novo,
    atendente_id = COALESCE(atendente_id, p_user),
    resposta = CASE WHEN p_motivo IS NOT NULL AND trim(p_motivo) <> '' THEN p_motivo ELSE resposta END,
    pr_numero = COALESCE(p_pr_numero, pr_numero),
    -- trava de coerência: concluido_em só existe em 'concluida'; qualquer outro status zera.
    concluido_em = CASE WHEN p_novo = 'concluida' THEN now() ELSE NULL END,
    -- confirmado_pelo_autor é ato do AUTOR (fn_sugestao_confirmar); mover para um status não concluído
    -- (reabertura/aguardando/recusada/arquivada) limpa a confirmação. 'concluida' preserva o que havia.
    confirmado_pelo_autor = CASE WHEN p_novo = 'concluida' THEN confirmado_pelo_autor ELSE false END,
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'status', p_novo,
    'concluida_sem_pr', (p_novo='concluida' AND p_pr_numero IS NULL AND (SELECT pr_numero FROM sugestoes WHERE id=p_id) IS NULL));
END $function$;

REVOKE ALL ON FUNCTION public.fn_sugestao_status(uuid, text, uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_status(uuid, text, uuid, text, integer) TO authenticated, service_role;
