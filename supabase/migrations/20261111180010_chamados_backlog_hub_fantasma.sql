-- Chamados · backlog do Hub, dono-fantasma e guarda de arquivamento (CEO 09/11, versão simples e segura).
-- NÃO mexe no roteamento vivo: fn_chamados_rotear e fn_hub_rotear_gaps ficam como estão.
--
-- 1) Coluna backlog_hub: marca o que é "o que falta no Hub" (listável depois). Aditiva, default false.
-- 2) Os 13 chamados de melhoria do Hub (Construtora Modelo - DEMO) saem do agente gilberto-produto (dono-fantasma),
--    ficam com agente VAZIO, sem responsável, marcados backlog_hub e interno = true (o roteador já pula internos,
--    então nenhum dos 13 entra na fila de ninguém). Diagnóstico (descricao) NÃO é tocado.
--    Só altera os números listados, e só se ainda estiverem com gilberto-produto (idempotente).
-- 3) fn_chamados_fantasmas(): LISTA chamados ativos cujo agente nunca executou (inclusive internos) e não é dono de sócio.
--    Só detecta; não re-roteia nada.
-- 4) Briefing de chamados ganha a chave "dono_fantasma" (a lista acima), pro eng-chefe decidir.
-- 5) Guarda de arquivamento: arquivar um chamado TÉCNICO (com rota e descrição >= 300 caracteres) é barrado no gatilho,
--    para qualquer caminho (fn_sugestao_status, update direto em sugestoes). Arquivamento geral continua igual.
--    Caminho com confirmação: fn_sugestao_arquivar_tecnico (só PS admin, grava motivo e auditoria).

-- 1) coluna
ALTER TABLE public.sugestoes ADD COLUMN IF NOT EXISTS backlog_hub boolean NOT NULL DEFAULT false;

-- 2) os 13 saem do dono-fantasma (agente vazio, backlog Hub, internos); diagnóstico intocado
UPDATE public.sugestoes
   SET agente = NULL, interno = true, backlog_hub = true, ultimo_movimento = now()
 WHERE numero IN (3333, 3341, 3346, 3360, 3363, 3365, 3660, 3742, 3807, 3808, 3809, 3810, 3811)
   AND agente = 'gilberto-produto'
   AND status IN ('nova', 'em_analise', 'em_desenvolvimento', 'aguardando_confirmacao');

-- 3) detecção de dono-fantasma (só lista)
CREATE OR REPLACE FUNCTION public.fn_chamados_fantasmas()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  -- sessão de usuário só para PS admin; sessão de serviço (briefing) passa
  IF auth.uid() IS NOT NULL AND NOT public.fn_eh_ps_admin() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('numero', x.numero, 'agente', x.agente, 'status', x.status,
                                               'titulo', x.titulo, 'interno', x.interno, 'backlog_hub', x.backlog_hub)
                            ORDER BY x.numero), '[]'::jsonb)
    INTO v
    FROM (SELECT s.numero, s.agente, s.status, s.titulo, coalesce(s.interno, false) AS interno, s.backlog_hub
            FROM public.sugestoes s
           WHERE s.status IN ('nova', 'em_analise', 'em_desenvolvimento', 'aguardando_confirmacao')
             AND s.numero IS NOT NULL
             AND s.agente IS NOT NULL AND btrim(s.agente) <> ''
             AND NOT EXISTS (SELECT 1 FROM public.erp_code_execucao_log l WHERE l.agente = s.agente)
             AND NOT EXISTS (SELECT 1 FROM public.erp_agente_dono d WHERE d.agente = s.agente AND d.ativo)) x;
  RETURN jsonb_build_object('ok', true, 'n', jsonb_array_length(v), 'chamados', v);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_chamados_fantasmas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_chamados_fantasmas() TO authenticated, service_role;

-- 4) briefing: mesmo corpo de antes + bloco dono_fantasma
CREATE OR REPLACE FUNCTION public.fn_chamados_briefing()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_orfaos jsonb; v_sens jsonb; v_parados int; v_resolvidos int; v_fantasmas jsonb;
BEGIN
  -- mesma guarda do briefing: sessão de usuário só para PS_ADMIN; sessão de serviço passa
  IF auth.uid() IS NOT NULL AND NOT public.fn_eh_ps_admin() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  -- ativos sem dono: sem agente e sem dono de sócio pelo escopo
  SELECT coalesce(jsonb_agg(x.numero ORDER BY x.numero), '[]'::jsonb) INTO v_orfaos
    FROM (SELECT s.numero FROM public.sugestoes s
           WHERE s.status IN ('nova', 'em_analise', 'em_desenvolvimento', 'aguardando_confirmacao')
             AND coalesce(s.interno, false) = false AND s.numero IS NOT NULL
             AND (s.agente IS NULL OR s.agente = '')
             AND public.fn_chamado_agente_dono(s.id) IS NULL) x;

  -- sensíveis esperando OK do CEO: tarefa de chamado com requer_ok_ceo e sem OK
  SELECT coalesce(jsonb_agg(jsonb_build_object('chamado', y.n, 'desde', y.d) ORDER BY y.d), '[]'::jsonb) INTO v_sens
    FROM (SELECT coalesce(s.numero, m.chamado_numero) AS n, m.criado_em AS d
            FROM public.erp_agente_mensagem m
            LEFT JOIN public.sugestoes s ON s.id = m.sugestao_id OR (m.sugestao_id IS NULL AND s.numero = m.chamado_numero)
           WHERE m.requer_ok_ceo AND m.ok_ceo_em IS NULL AND NOT coalesce(m.arquivada, false)
             AND m.status NOT IN ('concluida', 'recusada')
             AND (m.sugestao_id IS NOT NULL OR m.chamado_numero IS NOT NULL)) y;

  -- ativos parados há mais de 3 dias
  SELECT count(*) INTO v_parados FROM public.sugestoes s
   WHERE s.status IN ('nova', 'em_analise', 'em_desenvolvimento', 'aguardando_confirmacao')
     AND coalesce(s.interno, false) = false AND s.numero IS NOT NULL
     AND coalesce(s.ultimo_movimento, s.created_at) < now() - interval '3 days';

  -- resolvidos nos últimos 7 dias
  SELECT count(*) INTO v_resolvidos FROM public.sugestoes s
   WHERE s.status = 'concluida' AND s.concluido_em >= now() - interval '7 days';

  -- dono-fantasma: chamado ativo com agente que nunca executou (lista, não re-roteia)
  v_fantasmas := public.fn_chamados_fantasmas();

  RETURN jsonb_build_object(
    'ok', true,
    'orfaos_sem_dono', jsonb_build_object('n', jsonb_array_length(v_orfaos), 'numeros', v_orfaos),
    'sensiveis_aguardando_ok', jsonb_build_object('n', jsonb_array_length(v_sens), 'itens', v_sens),
    'ativos_parados_3d', v_parados,
    'resolvidos_7d', v_resolvidos,
    'dono_fantasma', coalesce(v_fantasmas -> 'chamados', '[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_chamados_briefing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_chamados_briefing() TO authenticated, service_role;

-- 5a) guarda de arquivamento na TABELA (cobre fn_sugestao_status e o update direto)
CREATE OR REPLACE FUNCTION public.trg_sugestao_arquivar_tecnico_guarda()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'arquivada' AND OLD.status IS DISTINCT FROM 'arquivada'
     AND NEW.rota IS NOT NULL AND length(coalesce(NEW.descricao, '')) >= 300
     AND coalesce(current_setting('app.arquivar_tecnico_ok', true), '') <> '1' THEN
    RAISE EXCEPTION 'Chamado técnico #% (tela %) não pode ser arquivado direto. Use a confirmação de arquivamento, que grava o motivo.', NEW.numero, NEW.rota
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_sugestao_arquivar_tecnico_guarda ON public.sugestoes;
CREATE TRIGGER trg_sugestao_arquivar_tecnico_guarda
  BEFORE UPDATE OF status ON public.sugestoes
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.trg_sugestao_arquivar_tecnico_guarda();

-- 5b) caminho com confirmação: só PS admin, motivo obrigatório, grava auditoria
-- ci-sem-guarda: fn_sugestao_arquivar_tecnico — RPC de plataforma (PS admin); o chamado não tem empresa de cliente a conferir
CREATE OR REPLACE FUNCTION public.fn_sugestao_arquivar_tecnico(p_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_numero int; v_status_ant text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.fn_eh_ps_admin() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Só administração da plataforma arquiva chamado técnico.');
  END IF;
  IF length(btrim(coalesce(p_motivo, ''))) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o motivo (mínimo 10 caracteres).');
  END IF;
  SELECT company_id, numero, status INTO v_comp, v_numero, v_status_ant FROM public.sugestoes WHERE id = p_id FOR UPDATE;
  IF v_numero IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'chamado_nao_encontrado');
  END IF;
  IF v_status_ant = 'arquivada' THEN
    RETURN jsonb_build_object('ok', true, 'id', p_id, 'ja_arquivado', true);
  END IF;
  PERFORM set_config('app.arquivar_tecnico_ok', '1', true);
  UPDATE public.sugestoes SET status = 'arquivada', ultimo_movimento = now() WHERE id = p_id;
  PERFORM set_config('app.arquivar_tecnico_ok', '', true);
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_comp, auth.uid(), 'sugestoes', p_id::text, 'arquivar_chamado_tecnico',
          jsonb_build_object('status', v_status_ant), jsonb_build_object('status', 'arquivada', 'motivo', p_motivo));
  RETURN jsonb_build_object('ok', true, 'id', p_id, 'numero', v_numero, 'ja_arquivado', false);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_sugestao_arquivar_tecnico(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_arquivar_tecnico(uuid, text) TO authenticated, service_role;
