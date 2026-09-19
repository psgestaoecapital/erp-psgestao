-- Bug rápido 0a: "Arquivar" chamado → status_invalido.
-- A tela oferece 'arquivada' e o CHECK (sugestoes_status_fluxo_chk) aceita, mas fn_sugestao_status tinha
-- a lista de status CRAVADA no corpo (sem 'arquivada') → recusava com status_invalido. Corrige tirando a
-- duplicação: a validação passa a vir da MESMA fonte do CHECK (fn_sugestao_status_permitidos), então nunca
-- mais diverge (quando 'aguardando_validacao' entrar no CHECK, já será aceito automaticamente).
-- Arquivar NÃO envia e-mail: fn_sugestao_status só muda status/resposta e nunca enfileira notificação.

-- Lista de status permitidos, extraída do próprio CHECK de sugestoes.status (fonte única).
CREATE OR REPLACE FUNCTION public.fn_sugestao_status_permitidos()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT array_agg(m[1] ORDER BY m[1])
  FROM (
    SELECT regexp_matches(pg_get_constraintdef(oid), '''([a-z_]+)''::text', 'g') AS m
    FROM pg_constraint
    WHERE conrelid = 'public.sugestoes'::regclass AND conname = 'sugestoes_status_fluxo_chk'
  ) x;
$$;
COMMENT ON FUNCTION public.fn_sugestao_status_permitidos() IS
  'Status válidos de sugestoes, lidos do CHECK sugestoes_status_fluxo_chk (fonte única — evita divergência tela/função/CHECK).';
GRANT EXECUTE ON FUNCTION public.fn_sugestao_status_permitidos() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_sugestao_status(p_id uuid, p_novo text, p_user uuid, p_motivo text DEFAULT NULL::text, p_pr_numero integer DEFAULT NULL::integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_atual text;
BEGIN
  IF NOT (is_admin() OR fn_pode_ver_fila_suporte()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT status INTO v_atual FROM sugestoes WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'sugestao_nao_encontrada'); END IF;
  -- validação vem da MESMA fonte do CHECK (inclui 'arquivada' e futuros como 'aguardando_validacao').
  IF p_novo IS NULL OR NOT (p_novo = ANY (public.fn_sugestao_status_permitidos())) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status_invalido'); END IF;
  IF p_novo = 'recusada' AND COALESCE(trim(p_motivo),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'recusa_exige_motivo'); END IF;  -- §5.3

  UPDATE sugestoes SET
    status = p_novo,
    atendente_id = COALESCE(atendente_id, p_user),
    resposta = CASE WHEN p_motivo IS NOT NULL AND trim(p_motivo) <> '' THEN p_motivo ELSE resposta END,
    pr_numero = COALESCE(p_pr_numero, pr_numero),
    concluido_em = CASE WHEN p_novo = 'concluida' THEN now() ELSE concluido_em END,
    updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'status', p_novo,
    'concluida_sem_pr', (p_novo='concluida' AND p_pr_numero IS NULL AND (SELECT pr_numero FROM sugestoes WHERE id=p_id) IS NULL));  -- §5.4
END $function$;
