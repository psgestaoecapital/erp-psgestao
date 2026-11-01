-- CANAL PS · PR B (CEO 07/10 16:20) — conector MCP do ERP (/api/mcp) para a Claude de cada sócio. Faixa 60.
-- O servidor MCP não tem chave de serviço nem SQL livre: cada ferramenta roda COMO O USUÁRIO LOGADO (token do Supabase
-- Auth) e só chama as RPCs abaixo (e as da PR A), todas com guarda e revogadas do anon.
--   • erp_canal_ps_chamada: registro de cada chamada de ferramenta (usuário, ferramenta, quando, resultado) + limite de uso.
--   • fn_canal_meus_chamados / fn_canal_ler_chamado: chamados SÓ da carteira do sócio (erp_carteira_responsavel vigente —
--     a mesma fonte dos chamados em equipe, RD-65); sem e-mail/telefone de quem abriu (LGPD: só o necessário).
--   • fn_canal_minhas_prs: erp_dev_entrega filtrado pelo Code do sócio.
--   • fn_agente_pedido_pedir_ok_ceo: marca o pedido de núcleo do sócio para o CEO ver na aba Codes (não dá o OK — o OK
--     continua só pelo Eng. Chefe, fn_agente_mensagem_ok_ceo).

-- ── registro e limite de uso ─────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_canal_ps_chamada (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES public.users(id),
  ferramenta   text NOT NULL,
  ok           boolean,
  resultado    text,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz
);
CREATE INDEX IF NOT EXISTS erp_canal_ps_chamada_user_idx ON public.erp_canal_ps_chamada (user_id, criado_em DESC);
COMMENT ON TABLE public.erp_canal_ps_chamada IS
  'Canal PS: cada chamada de ferramenta do conector MCP (usuário, ferramenta, quando, resultado). Grava só pelas RPCs fn_canal_ps_chamada_*.';
ALTER TABLE public.erp_canal_ps_chamada ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_canal_ps_chamada FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.erp_canal_ps_chamada TO authenticated;
GRANT ALL ON TABLE public.erp_canal_ps_chamada TO service_role;
DROP POLICY IF EXISTS erp_canal_ps_chamada_sel ON public.erp_canal_ps_chamada;
CREATE POLICY erp_canal_ps_chamada_sel ON public.erp_canal_ps_chamada FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.fn_dev_painel_pode_ver());

-- ci-sem-guarda: fn_canal_ps_chamada_iniciar — grava só a linha do PRÓPRIO usuário (auth.uid()), sem empresa nem dado de cliente
CREATE OR REPLACE FUNCTION public.fn_canal_ps_chamada_iniciar(p_ferramenta text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid(); v_hora int; v_min int; v_id bigint;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'login_obrigatorio', 'mensagem', 'Conecte com o seu usuário do ERP.'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('canal_ps:' || v_uid::text));
  SELECT count(*) FILTER (WHERE criado_em > now() - interval '1 hour'), count(*) FILTER (WHERE criado_em > now() - interval '1 minute')
    INTO v_hora, v_min FROM erp_canal_ps_chamada WHERE user_id = v_uid AND criado_em > now() - interval '1 hour';
  IF v_min >= 20 OR v_hora >= 200 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'limite_uso', 'mensagem',
      'Limite do Canal PS: 20 chamadas por minuto e 200 por hora por pessoa. Espere um pouco e tente de novo.');
  END IF;
  INSERT INTO erp_canal_ps_chamada (user_id, ferramenta) VALUES (v_uid, left(coalesce(nullif(btrim(p_ferramenta), ''), '?'), 80))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_canal_ps_chamada_iniciar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_canal_ps_chamada_iniciar(text) TO authenticated;

-- ci-sem-guarda: fn_canal_ps_chamada_concluir — só fecha a linha do PRÓPRIO usuário (user_id = auth.uid()) ainda aberta
CREATE OR REPLACE FUNCTION public.fn_canal_ps_chamada_concluir(p_id bigint, p_ok boolean, p_resultado text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  UPDATE erp_canal_ps_chamada SET ok = coalesce(p_ok, false), resultado = left(coalesce(p_resultado, ''), 200), concluido_em = now()
   WHERE id = p_id AND user_id = auth.uid() AND concluido_em IS NULL;
  RETURN jsonb_build_object('ok', FOUND);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_canal_ps_chamada_concluir(bigint, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_canal_ps_chamada_concluir(bigint, boolean, text) TO authenticated;

-- ── chamados da carteira ─────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_canal_meus_chamados(p_status text DEFAULT NULL, p_empresa_id uuid DEFAULT NULL,
  p_desde date DEFAULT NULL, p_ate date DEFAULT NULL, p_limite integer DEFAULT 30)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'login_obrigatorio'); END IF;
  IF p_empresa_id IS NOT NULL AND NOT public.fn__carteira_usuario_pode(v_uid, p_empresa_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'fora_da_carteira',
      'mensagem', 'Essa empresa não está na sua carteira (Administração › Carteira). Liste sem filtro de empresa para ver as suas.');
  END IF;
  RETURN jsonb_build_object('ok', true, 'chamados', coalesce((
    SELECT jsonb_agg(x ORDER BY (x->>'atualizado_em') DESC) FROM (
      SELECT jsonb_build_object('numero', s.numero, 'titulo', s.titulo, 'status', s.status, 'aberto', public.fn__chamado_aberto(s.status),
               'prioridade', s.prioridade, 'categoria', s.categoria, 'empresa_id', s.company_id,
               'empresa', coalesce(nullif(btrim(c.nome_fantasia), ''), c.razao_social),
               'atendente', public.fn__chamado_nome(s.atendente_id), 'pr_numero', s.pr_numero,
               'criado_em', s.created_at, 'atualizado_em', coalesce(s.ultimo_movimento, s.updated_at, s.created_at)) AS x
        FROM sugestoes s
        JOIN erp_carteira_responsavel k ON k.company_id = s.company_id AND k.responsavel_id = v_uid AND k.vigencia_fim IS NULL
        LEFT JOIN companies c ON c.id = s.company_id
       WHERE (p_empresa_id IS NULL OR s.company_id = p_empresa_id)
         AND (p_status IS NULL OR (p_status = 'abertos' AND public.fn__chamado_aberto(s.status)) OR s.status = p_status)
         AND (p_desde IS NULL OR s.created_at >= p_desde::timestamp AT TIME ZONE 'America/Sao_Paulo')
         AND (p_ate IS NULL OR s.created_at < (p_ate + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
       ORDER BY coalesce(s.ultimo_movimento, s.updated_at, s.created_at) DESC
       LIMIT least(greatest(coalesce(p_limite, 30), 1), 100)) y), '[]'::jsonb));
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_canal_meus_chamados(text, uuid, date, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_canal_meus_chamados(text, uuid, date, date, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_canal_ler_chamado(p_numero integer)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid(); s record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'login_obrigatorio'); END IF;
  SELECT * INTO s FROM sugestoes WHERE numero = p_numero;
  -- não existe ou não é da carteira: a mesma resposta (não revela chamado de outro sócio)
  IF NOT FOUND OR s.company_id IS NULL OR NOT public.fn__carteira_usuario_pode(v_uid, s.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'fora_da_carteira',
      'mensagem', format('O chamado #%s não está na sua carteira (ou não existe). Use meus_chamados para ver os seus.', p_numero));
  END IF;
  RETURN jsonb_build_object('ok', true, 'chamado', jsonb_build_object(
    'numero', s.numero, 'titulo', s.titulo, 'descricao', s.descricao, 'status', s.status, 'prioridade', s.prioridade,
    'categoria', s.categoria, 'tipo', s.tipo, 'rota', s.rota, 'empresa_id', s.company_id,
    'empresa', (SELECT coalesce(nullif(btrim(c.nome_fantasia), ''), c.razao_social) FROM companies c WHERE c.id = s.company_id),
    'aberto_por', nullif(split_part(coalesce(s.user_name, ''), ' ', 1), ''),
    'atendente', public.fn__chamado_nome(s.atendente_id), 'responsavel', public.fn__chamado_nome(s.responsavel_id),
    'pr_numero', s.pr_numero, 'resposta', s.resposta, 'criado_em', s.created_at, 'atualizado_em', s.updated_at,
    'conversa', coalesce((
      SELECT jsonb_agg(jsonb_build_object('papel', m.papel, 'texto', m.texto, 'em', m.criado_em) ORDER BY m.criado_em)
        FROM sugestao_mensagem m WHERE m.sugestao_id = s.id), '[]'::jsonb)));
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_canal_ler_chamado(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_canal_ler_chamado(integer) TO authenticated;

-- ── PRs do Code do sócio ─────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_canal_minhas_prs(p_dias integer DEFAULT 7)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid(); v_agente text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'login_obrigatorio'); END IF;
  SELECT agente INTO v_agente FROM erp_agente_dono WHERE user_id = v_uid ORDER BY ativo DESC LIMIT 1;
  IF v_agente IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_code', 'mensagem', 'Seu usuário não é dono de nenhum Code.');
  END IF;
  RETURN jsonb_build_object('ok', true, 'code', v_agente, 'eventos', coalesce((
    SELECT jsonb_agg(jsonb_build_object('pr_numero', e.pr_numero, 'titulo', e.titulo, 'evento', e.evento, 'via', e.via,
             'url', e.url, 'ocorrido_em', e.ocorrido_em) ORDER BY e.ocorrido_em DESC)
      FROM erp_dev_entrega e
     WHERE e.code = v_agente AND e.ocorrido_em > now() - make_interval(days => least(greatest(coalesce(p_dias, 7), 1), 60))), '[]'::jsonb));
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_canal_minhas_prs(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_canal_minhas_prs(integer) TO authenticated;

-- ── pedido de núcleo: o sócio pede o OK ao CEO (marca para a aba Codes) ──────────────────────────────────────────
ALTER TABLE public.erp_agente_mensagem ADD COLUMN IF NOT EXISTS ok_ceo_pedido_em timestamptz;
GRANT SELECT (requer_ok_ceo, ok_ceo_em, ok_ceo_pedido_em, empresa_id, chamado_numero) ON TABLE public.erp_agente_mensagem TO authenticated;

-- ci-sem-guarda: fn_agente_pedido_pedir_ok_ceo — só marca pedido do PRÓPRIO sócio (de = remetente do dono = auth.uid()); não dá o OK nem aciona
CREATE OR REPLACE FUNCTION public.fn_agente_pedido_pedir_ok_ceo(p_mensagem_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid(); m record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'login_obrigatorio'); END IF;
  SELECT msg.* INTO m FROM erp_agente_mensagem msg JOIN erp_agente_dono d ON d.remetente_chat = msg.de AND d.agente = msg.para
   WHERE msg.id = p_mensagem_id AND d.user_id = v_uid FOR UPDATE OF msg;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'pedido_nao_encontrado', 'mensagem', 'Não achei esse pedido entre os seus (use respostas_do_meu_code).');
  END IF;
  IF NOT m.requer_ok_ceo THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_nucleo', 'mensagem', 'Esse pedido não é de núcleo: ele já foi direto ao seu Code.');
  END IF;
  IF m.ok_ceo_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_aprovado', m.ok_ceo_em, 'mensagem', 'O CEO já deu o OK; o Code já foi acionado.');
  END IF;
  UPDATE erp_agente_mensagem SET ok_ceo_pedido_em = coalesce(ok_ceo_pedido_em, now()), atualizado_em = now() WHERE id = p_mensagem_id;
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_novo)
  VALUES (m.empresa_id, v_uid, (SELECT u.email FROM users u WHERE u.id = v_uid), 'erp_agente_mensagem', p_mensagem_id::text,
          'agente_pedido_pedir_ok_ceo', jsonb_build_object('agente', m.para, 'assunto', m.assunto));
  RETURN jsonb_build_object('ok', true, 'mensagem', 'Pedido marcado para o CEO na aba Codes. O Code só começa depois do OK dele.');
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_agente_pedido_pedir_ok_ceo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agente_pedido_pedir_ok_ceo(uuid) TO authenticated;
