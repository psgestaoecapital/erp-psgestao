-- Escopo de agente de sócio no banco + OK do sócio (CEO 05/10 · rodrigo-code). Faixa de migration 00 (gilberto-desenv).
-- Genérica: jordana-code e andre-code entram depois só com uma linha em erp_agente_escopo (+ o id no CHECK da caixa).
--   1) erp_agente_escopo: agente da caixa ↔ usuário sócio (e o id que erp_chamado_equipe.agente usa: 'code-rodrigo' ≠ 'rodrigo-code').
--   2) fn_agente_escopo_chamado / fn_chamado_agente_dono: chamado ABERTO pelo sócio OU com o sócio como RESPONSÁVEL
--      (mesma regra da coluna responsavel_nome de v_sugestao_fila: sugestoes.responsavel_id).
--   3) Gatilho em chamado novo (e na troca de responsável/empresa): enfileira a tarefa na caixa do agente dono, se a rotina
--      estiver ligada. O despertador (5 min) aciona; backfill dos chamados abertos quando a rotina é ligada.
--   4) Guarda: outro agente não age em chamado de agente de sócio; o agente de sócio só age no próprio escopo.
--   5) OK do sócio: pedido do Code → botão Aprovar/Recusar só para o sócio dono; fn_agente_chamado_responder do agente de
--      sócio exige ok_socio aprovado (em vez de ok_ceo).
--   6) rodrigo-code entra com aciona=false (o Eng. Chefe liga depois de confirmar os segredos no cofre).
-- Definições vivas lidas com pg_get_functiondef antes de reescrever (fn_agente_chamado_responder, fn_agente_mensagem_trg_acionar).
-- Nenhuma função de guarda (RD-91) é alterada. Nada é apagado.

-- 1) escopo ------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_agente_escopo (
  agente          text PRIMARY KEY REFERENCES public.erp_agente_rotina(agente),
  socio_user_id   uuid NOT NULL REFERENCES public.users(id),
  equipe_agente   text,                                  -- id em erp_chamado_equipe.agente (ex.: 'code-rodrigo')
  ativo           boolean NOT NULL DEFAULT true,
  criado_em       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_agente_escopo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_agente_escopo FROM PUBLIC, anon, authenticated;   -- só service_role (sem policy)

INSERT INTO public.erp_agente_escopo (agente, socio_user_id, equipe_agente)
SELECT 'rodrigo-code', e.user_id, e.agente FROM public.erp_chamado_equipe e WHERE e.nome_curto = 'Rodrigo'
ON CONFLICT (agente) DO NOTHING;

-- 2) colunas do OK do sócio e vínculo da mensagem com o chamado ----------------------------------------------------------
ALTER TABLE public.erp_agente_mensagem
  ADD COLUMN IF NOT EXISTS sugestao_id        uuid,
  ADD COLUMN IF NOT EXISTS pedido_ok_socio    text,
  ADD COLUMN IF NOT EXISTS pedido_ok_socio_em timestamptz,
  ADD COLUMN IF NOT EXISTS ok_socio_em        timestamptz,
  ADD COLUMN IF NOT EXISTS ok_socio_por       uuid,
  ADD COLUMN IF NOT EXISTS ok_socio_decisao   text;
ALTER TABLE public.erp_agente_mensagem DROP CONSTRAINT IF EXISTS erp_agente_mensagem_ok_socio_decisao_check;
ALTER TABLE public.erp_agente_mensagem ADD CONSTRAINT erp_agente_mensagem_ok_socio_decisao_check
  CHECK (ok_socio_decisao IS NULL OR ok_socio_decisao IN ('aprovado','recusado'));
CREATE INDEX IF NOT EXISTS erp_agente_mensagem_sugestao_idx ON public.erp_agente_mensagem (sugestao_id) WHERE sugestao_id IS NOT NULL;

-- o agente de sócio passa a poder receber TAREFA (os demais sócios continuam só com aviso)
ALTER TABLE public.erp_agente_mensagem DROP CONSTRAINT IF EXISTS erp_agente_mensagem_socio_so_aviso;
ALTER TABLE public.erp_agente_mensagem ADD CONSTRAINT erp_agente_mensagem_socio_so_aviso
  CHECK (tipo = 'aviso' OR para = ANY (ARRAY['gilberto-desenv','gilberto-produto','gilberto-chamados','rodrigo-code']));

-- 3) escopo ----------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn__agente_escopo_chamado_i(p_agente text, p_chamado uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM erp_agente_escopo e JOIN sugestoes s ON s.id = p_chamado
     WHERE e.agente = p_agente AND e.ativo
       AND (s.user_id = e.socio_user_id OR s.responsavel_id = e.socio_user_id));
$function$;
REVOKE ALL ON FUNCTION public.fn__agente_escopo_chamado_i(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn__chamado_agente_dono_i(p_chamado uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT e.agente FROM erp_agente_escopo e
   WHERE e.ativo AND public.fn__agente_escopo_chamado_i(e.agente, p_chamado)
   ORDER BY e.agente LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.fn__chamado_agente_dono_i(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_agente_escopo_chamado(p_agente text, p_chamado uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn__agente_assert_servico();
  RETURN public.fn__agente_escopo_chamado_i(p_agente, p_chamado);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_agente_escopo_chamado(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agente_escopo_chamado(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_chamado_agente_dono(p_chamado uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn__agente_assert_servico();
  RETURN public.fn__chamado_agente_dono_i(p_chamado);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_chamado_agente_dono(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_chamado_agente_dono(uuid) TO service_role;

-- 4) enfileirar chamado na caixa do agente dono --------------------------------------------------------------------------
-- ci-sem-guarda: fn__agente_enfileirar_chamado — interna (revogada de todos), só chamada por gatilho/backfill; escreve na caixa de agentes, não em dado de empresa
CREATE OR REPLACE FUNCTION public.fn__agente_enfileirar_chamado(p_chamado uuid, p_origem text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE s record; v_ag text;
BEGIN
  SELECT id, numero, titulo, descricao, status INTO s FROM sugestoes WHERE id = p_chamado;
  IF NOT FOUND OR s.status NOT IN ('nova','em_analise','aceita','em_desenvolvimento') THEN RETURN false; END IF;
  v_ag := public.fn__chamado_agente_dono_i(p_chamado);
  IF v_ag IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_agente_rotina WHERE agente = v_ag AND aciona) THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM erp_agente_mensagem WHERE para = v_ag AND sugestao_id = p_chamado AND NOT arquivada
                AND status IN ('nova','recebida','em_andamento')) THEN RETURN false; END IF;   -- sem duplicar tarefa ativa
  INSERT INTO erp_agente_mensagem (para, de, tipo, assunto, corpo, requer_ok_ceo, enviado_por, sugestao_id, atualizado_em)
  VALUES (v_ag, 'eng_chefe', 'tarefa',
          left('[#' || s.numero || '] ' || COALESCE(NULLIF(btrim(s.titulo), ''), left(COALESCE(s.descricao, 'chamado'), 80)), 200),
          'Chamado #' || s.numero || ' (id ' || s.id || ') no seu escopo. Leia o chamado, trabalhe nele e, para responder ao cliente, '
          || 'peça o OK do sócio com fn_agente_pedir_ok_socio e só então use fn_agente_chamado_responder. '
          || E'\n\nTítulo: ' || COALESCE(s.titulo, '—') || E'\n\n' || COALESCE(s.descricao, ''),
          false, 'sistema · ' || p_origem, p_chamado,
          now() - interval '10 minutes');   -- já "parada": o despertador (5 min) aciona no próximo ciclo
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn__agente_enfileirar_chamado(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn__sugestao_enfileirar_agente_socio()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn__agente_enfileirar_chamado(NEW.id, CASE WHEN TG_OP = 'INSERT' THEN 'chamado novo' ELSE 'chamado reatribuído' END);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;   -- a fila do agente nunca pode impedir o cliente de abrir um chamado
END;
$function$;
REVOKE ALL ON FUNCTION public.fn__sugestao_enfileirar_agente_socio() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sugestao_enfileirar_agente_socio ON public.sugestoes;
CREATE TRIGGER trg_sugestao_enfileirar_agente_socio
  AFTER INSERT OR UPDATE OF responsavel_id, company_id ON public.sugestoes
  FOR EACH ROW EXECUTE FUNCTION public.fn__sugestao_enfileirar_agente_socio();

-- mensagem gerada pelo sistema não aciona na hora (o despertador dá o ritmo, um por agente por ciclo); o gatilho de acionar
-- também roda na sessão do cliente que abriu o chamado, onde a guarda do canal recusaria
CREATE OR REPLACE FUNCTION public.fn_agente_mensagem_trg_acionar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT NEW.arquivada AND COALESCE(NEW.enviado_por, '') NOT LIKE 'sistema ·%' THEN PERFORM public.fn_agente_acionar(NEW.id); END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.requer_ok_ceo AND OLD.ok_ceo_em IS NULL AND NEW.ok_ceo_em IS NOT NULL AND NOT NEW.arquivada THEN
      PERFORM public.fn_agente_acionar(NEW.id);
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_agente_mensagem_trg_acionar() FROM PUBLIC, anon, authenticated;

-- backfill manual (nunca automático): enfileira os chamados abertos do escopo
CREATE OR REPLACE FUNCTION public.fn_agente_escopo_backfill(p_agente text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; v_n int := 0;
BEGIN
  PERFORM public.fn__agente_assert_servico();
  FOR r IN SELECT s.id FROM sugestoes s
            WHERE s.status IN ('nova','em_analise','aceita','em_desenvolvimento')
              AND public.fn__agente_escopo_chamado_i(p_agente, s.id)
            ORDER BY s.numero LOOP
    IF public.fn__agente_enfileirar_chamado(r.id, 'backfill') THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'agente', p_agente, 'enfileirados', v_n);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_agente_escopo_backfill(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agente_escopo_backfill(text) TO service_role;

-- Sem backfill automático ao ligar a rotina (Eng. Chefe 05/10): a rodrigo-code já tem a fila dos 13 por aviso; rodar de novo duplicaria.
-- fn_agente_escopo_backfill fica só como ação manual (serviço) para jordana-code/andre-code.
DROP TRIGGER IF EXISTS trg_agente_rotina_ligou_backfill ON public.erp_agente_rotina;
DROP FUNCTION IF EXISTS public.fn__agente_rotina_ligou_backfill();

-- 5) OK do sócio ----------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_agente_pedir_ok_socio(p_mensagem_id uuid, p_agente text, p_texto text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE m record; v_texto text := btrim(COALESCE(p_texto, ''));
BEGIN
  PERFORM public.fn__agente_assert_servico();
  SELECT * INTO m FROM erp_agente_mensagem WHERE id = p_mensagem_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_nao_encontrada'); END IF;
  IF m.para <> p_agente THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_de_outro_agente'); END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_agente_escopo WHERE agente = p_agente AND ativo) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'agente_sem_socio'); END IF;
  IF m.status IN ('concluida','recusada') OR m.arquivada THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_encerrada'); END IF;
  IF v_texto = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'texto_vazio'); END IF;
  UPDATE erp_agente_mensagem
     SET pedido_ok_socio = v_texto, pedido_ok_socio_em = now(),
         ok_socio_decisao = NULL, ok_socio_em = NULL, ok_socio_por = NULL, atualizado_em = now()
   WHERE id = p_mensagem_id;
  RETURN jsonb_build_object('ok', true, 'id', p_mensagem_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_agente_pedir_ok_socio(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agente_pedir_ok_socio(uuid, text, text) TO service_role;

-- ci-sem-guarda: fn_agente_ok_socio — confere auth.uid() = socio_user_id do agente dono da mensagem (erp_agente_escopo)
CREATE OR REPLACE FUNCTION public.fn_agente_ok_socio(p_mensagem_id uuid, p_decisao text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE m record; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  IF p_decisao IS NULL OR p_decisao NOT IN ('aprovado','recusado') THEN RETURN jsonb_build_object('ok', false, 'erro', 'decisao_invalida'); END IF;
  SELECT msg.* INTO m FROM erp_agente_mensagem msg WHERE msg.id = p_mensagem_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_nao_encontrada'); END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_agente_escopo e WHERE e.agente = m.para AND e.ativo AND e.socio_user_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_o_socio_dono'); END IF;
  IF m.pedido_ok_socio IS NULL OR m.status IN ('concluida','recusada') OR m.arquivada THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_pedido_aberto'); END IF;
  IF m.ok_socio_decisao IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'ja_decidido', 'decisao', m.ok_socio_decisao); END IF;
  UPDATE erp_agente_mensagem SET ok_socio_decisao = p_decisao, ok_socio_em = now(), ok_socio_por = v_uid, atualizado_em = now()
   WHERE id = p_mensagem_id;
  RETURN jsonb_build_object('ok', true, 'id', p_mensagem_id, 'decisao', p_decisao);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_agente_ok_socio(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agente_ok_socio(uuid, text) TO authenticated;

-- pedido pendente de um chamado, visível SÓ ao sócio dono (a tela do chamado mostra "O Code pede sua aprovação")
CREATE OR REPLACE FUNCTION public.fn_agente_ok_socio_pendente(p_sugestao uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT jsonb_build_object('mensagem_id', m.id, 'agente', m.para, 'texto', m.pedido_ok_socio, 'pedido_em', m.pedido_ok_socio_em)
      FROM erp_agente_mensagem m JOIN erp_agente_escopo e ON e.agente = m.para AND e.ativo AND e.socio_user_id = auth.uid()
     WHERE m.sugestao_id = p_sugestao AND m.pedido_ok_socio IS NOT NULL AND m.ok_socio_decisao IS NULL
       AND NOT m.arquivada AND m.status IN ('nova','recebida','em_andamento')
     ORDER BY m.pedido_ok_socio_em DESC LIMIT 1), 'null'::jsonb);
$function$;
REVOKE ALL ON FUNCTION public.fn_agente_ok_socio_pendente(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agente_ok_socio_pendente(uuid) TO authenticated;

-- 6) fn_agente_chamado_responder: guarda de escopo + OK do sócio para agente de sócio (OK do CEO continua para os demais)
CREATE OR REPLACE FUNCTION public.fn_agente_chamado_responder(p_mensagem_agente uuid, p_sugestao_id uuid, p_texto text, p_novo_status text DEFAULT NULL::text, p_hash_aprovado text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m record; s record; v_ceo_email text; v_ceo_user uuid; v_msg uuid; v_notif uuid; v_status text; v_hash text; v_texto text := btrim(COALESCE(p_texto,''));
  v_socio uuid; v_dono text; v_aprovador uuid;
BEGIN
  PERFORM public.fn__agente_assert_servico();
  SELECT * INTO m FROM erp_agente_mensagem WHERE id = p_mensagem_agente FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_nao_encontrada'); END IF;
  SELECT socio_user_id INTO v_socio FROM erp_agente_escopo WHERE agente = m.para AND ativo;
  IF v_socio IS NOT NULL THEN
    -- agente de sócio: só no próprio escopo e só com o OK do sócio dono
    IF m.tipo <> 'tarefa' OR m.ok_socio_decisao IS DISTINCT FROM 'aprovado' THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'sem_ok_do_socio'); END IF;
    IF NOT public.fn__agente_escopo_chamado_i(m.para, p_sugestao_id) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'chamado_fora_do_escopo'); END IF;
  ELSE
    IF m.tipo <> 'tarefa' OR NOT m.requer_ok_ceo OR m.ok_ceo_em IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'sem_ok_do_ceo'); END IF;
    -- chamado de agente de sócio: nenhum outro agente age nele
    v_dono := public.fn__chamado_agente_dono_i(p_sugestao_id);
    IF v_dono IS NOT NULL AND v_dono <> m.para THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'chamado_de_agente_socio', 'dono', v_dono); END IF;
  END IF;
  IF m.status IN ('concluida','recusada') OR m.arquivada THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_encerrada'); END IF;
  IF v_texto = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'texto_vazio'); END IF;
  IF p_novo_status IS NOT NULL AND p_novo_status NOT IN ('em_analise','aceita','em_desenvolvimento','aguardando_confirmacao','concluida','recusada') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status_invalido'); END IF;
  -- o autor é a conta PS configurada (erp_agente_config), nunca um parâmetro do chamador; tem de ser PS_ADMIN/PS_ADMIN_CVM de verdade
  SELECT u.id, u.email INTO v_ceo_user, v_ceo_email FROM users u
   WHERE lower(u.email) = lower((SELECT valor FROM erp_agente_config WHERE chave = 'chamado_autor_email'))
     AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM');
  IF v_ceo_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'ceo_nao_identificado'); END IF;
  SELECT id, user_id, numero, titulo, status INTO s FROM sugestoes WHERE id = p_sugestao_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'chamado_nao_encontrado'); END IF;
  IF s.user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'chamado_sem_autor'); END IF;   -- sem destinatário não há aviso

  v_hash := encode(sha256(convert_to(v_texto, 'UTF8')), 'hex');
  IF p_hash_aprovado IS NOT NULL AND lower(btrim(p_hash_aprovado)) <> v_hash THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'texto_diferente_do_aprovado', 'texto_hash', v_hash); END IF;
  -- com OK do sócio, o texto postado tem de ser o que ele aprovou (o pedido leva o texto)
  IF v_socio IS NOT NULL AND m.pedido_ok_socio IS NOT NULL AND position(v_texto IN m.pedido_ok_socio) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'texto_fora_do_pedido_aprovado'); END IF;
  v_aprovador := COALESCE(v_socio, v_ceo_user);
  v_status := CASE WHEN p_novo_status IS NOT NULL THEN p_novo_status
                   WHEN s.status IN ('nova','em_analise','aceita','em_desenvolvimento') OR s.status IS NULL THEN 'aguardando_confirmacao'
                   ELSE s.status END;

  INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto, criado_em,
                                 redigido_por, aprovado_por, ok_ceo_em, mensagem_agente_id, texto_hash, ok_ceo_origem, ok_registrado_por)
  VALUES (p_sugestao_id, v_ceo_user, v_ceo_email, 'ps', v_texto, now(),
          m.para, v_aprovador, CASE WHEN v_socio IS NULL THEN m.ok_ceo_em ELSE m.ok_socio_em END, m.id, v_hash,
          CASE WHEN v_socio IS NULL THEN m.ok_ceo_origem ELSE 'ok_socio' END,
          CASE WHEN v_socio IS NULL THEN m.ok_registrado_por ELSE v_socio::text END)
  RETURNING id INTO v_msg;

  -- mesmo efeito de fn_sugestao_aprovar_resposta: a resposta fica aprovada e o chamado anda
  UPDATE sugestoes SET resposta = v_texto, resposta_aprovada = true, resposta_aprovada_por = v_aprovador, resposta_aprovada_em = now(),
         status = v_status, confirmado_pelo_autor = false, updated_at = now()
   WHERE id = p_sugestao_id;

  -- a MESMA notificação do caminho normal (tipo 'resposta' → fn_sugestao_email_fila manda o e-mail)
  INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem, email_status, email_proxima_tentativa)
  VALUES (p_sugestao_id, s.user_id, 'resposta', '#' || s.numero || ' · Resposta ao seu chamado: ' || COALESCE(NULLIF(btrim(s.titulo),''), 'sua sugestão'),
          'A equipe PS respondeu. Abra a Central de Melhorias para ver e confirmar se resolveu.', 'pendente', now())
  RETURNING id INTO v_notif;

  RETURN jsonb_build_object('ok', true, 'mensagem_id', v_msg, 'notificacao_id', v_notif, 'status', v_status, 'texto_hash', v_hash);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_agente_chamado_responder(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agente_chamado_responder(uuid, uuid, text, text, text) TO service_role;
