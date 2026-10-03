-- Caixa de mensagens dos agentes (CEO 03/10, registrado em erp_contexto_projeto "fluxo de comunicação CEO → Eng. Chefe
-- → Codes"): o CEO fala só com o Eng. Chefe; o Eng. Chefe escreve aqui a tarefa do Code; o banco aciona a ROTINA do
-- Code destinatário (claude.ai/code/routines, gatilho de API) via pg_net; o Code lê a própria caixa, executa e responde
-- na própria mensagem (BOX). Acaba o copia e cola.
--
-- Canal protegido: as tabelas ficam fechadas para anônimo e usuário logado (nenhuma tela do ERP lê ou grava). Só a
-- conexão de serviço (Eng. Chefe pelo conector do banco; Codes pela sessão de serviço) usa as funções abaixo.
-- Identificadores oficiais (CEO 03/10): gilberto-desenv, gilberto-chamados, rodrigo-code, jordana-code, andre-code,
-- stephany-code. O Eng. Chefe dirige gilberto-desenv e gilberto-chamados; aos Codes dos sócios só manda AVISO.
-- URL e token de cada rotina ficam no cofre (vault) com os nomes agente_rotina_url_<agente> e
-- agente_rotina_token_<agente>, gravados pelo CEO no painel do Supabase; nunca passam por chat, log ou código.
-- Sem plantão automático (sem cron): só aciona quando chega mensagem ou quando o OK do CEO é registrado.

-- ── tabelas ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_agente_rotina (
  agente      text PRIMARY KEY CHECK (agente IN ('gilberto-desenv','gilberto-chamados','rodrigo-code','jordana-code','andre-code','stephany-code')),
  aciona      boolean NOT NULL DEFAULT false,   -- dispara a rotina ao chegar mensagem (só os Codes dirigidos pelo Eng. Chefe)
  observacao  text,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.erp_agente_rotina (agente, aciona, observacao) VALUES
  ('gilberto-desenv',   true,  'Desenvolvedor — dirigido pelo Eng. Chefe'),
  ('gilberto-chamados', true,  'Chamados — dirigido pelo Eng. Chefe'),
  ('rodrigo-code',      false, 'Code do sócio — só avisos de coordenação'),
  ('jordana-code',      false, 'Code da sócia — só avisos de coordenação'),
  ('andre-code',        false, 'Code do sócio — só avisos de coordenação'),
  ('stephany-code',     false, 'Code da sócia — só avisos de coordenação')
ON CONFLICT (agente) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.erp_agente_mensagem (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  para           text NOT NULL REFERENCES public.erp_agente_rotina(agente),
  de             text NOT NULL CHECK (de IN ('eng_chefe','ceo')),
  tipo           text NOT NULL DEFAULT 'tarefa' CHECK (tipo IN ('tarefa','aviso')),
  assunto        text NOT NULL CHECK (length(btrim(assunto)) > 0),
  corpo          text NOT NULL CHECK (length(btrim(corpo)) > 0),
  requer_ok_ceo  boolean NOT NULL DEFAULT false,
  ok_ceo_em      timestamptz,
  ok_ceo_origem  text,
  status         text NOT NULL DEFAULT 'nova' CHECK (status IN ('nova','recebida','em_andamento','concluida','recusada')),
  resposta       text,                          -- BOX curto do Code
  pr_numero      integer,
  acionamento    jsonb,                         -- último disparo da rotina: {em, request_id | motivo}
  enviado_por    text NOT NULL,                 -- quem chamou fn_agente_mensagem_enviar (declarado + sessão do banco)
  ok_registrado_por text,                       -- quem chamou fn_agente_mensagem_ok_ceo (declarado + sessão do banco)
  arquivada      boolean NOT NULL DEFAULT false, -- nada é apagado
  criado_em      timestamptz NOT NULL DEFAULT now(),
  recebida_em    timestamptz,
  iniciada_em    timestamptz,
  concluida_em   timestamptz,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  -- aos Codes dos sócios o Eng. Chefe só manda aviso de coordenação
  CONSTRAINT erp_agente_mensagem_socio_so_aviso
    CHECK (tipo = 'aviso' OR para IN ('gilberto-desenv','gilberto-chamados')),
  CONSTRAINT erp_agente_mensagem_ok_coerente
    CHECK (ok_ceo_em IS NULL OR requer_ok_ceo)
);
CREATE INDEX IF NOT EXISTS ix_agente_mensagem_caixa ON public.erp_agente_mensagem (para, status, criado_em) WHERE NOT arquivada;

ALTER TABLE public.erp_agente_rotina   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_agente_mensagem ENABLE ROW LEVEL SECURITY;
-- canal protegido: nenhuma policy; nem anônimo nem usuário logado tocam nas tabelas
REVOKE ALL ON TABLE public.erp_agente_rotina   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.erp_agente_mensagem FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.erp_agente_rotina   TO service_role;
GRANT ALL ON TABLE public.erp_agente_mensagem TO service_role;

-- ── guarda: só a conexão de serviço (sem usuário logado) ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn__agente_assert_servico()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'caixa_de_agentes_so_pelo_canal_protegido' USING ERRCODE = '42501';
  END IF;
END;
$function$;

-- quem está chamando: o que o chamador declara (ex.: 'eng_chefe · chat') + a sessão do banco (papel e aplicação).
-- A caixa só é gravada pela conexão de serviço; isto registra QUAL sessão/agente fez cada envio e cada OK.
CREATE OR REPLACE FUNCTION public.fn__agente_sessao(p_declarado text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(NULLIF(btrim(p_declarado), ''), 'não declarado')
      || ' | sessão: ' || session_user || '/' || current_user
      || COALESCE(' | app: ' || NULLIF(current_setting('application_name', true), ''), '')
      || COALESCE(' | papel jwt: ' || (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '');
$function$;

-- ── acionamento da rotina do agente (pg_net + cofre) ───────────────────────────────────────────────────────────────
-- O texto enviado é só um aviso ("nova mensagem <id>"); a tarefa em si fica no banco, que o Code lê pelo canal protegido.
-- URL e token são lidos do cofre aqui dentro e não saem da função (não vão para retorno, log nem tabela).
CREATE OR REPLACE FUNCTION public.fn_agente_acionar(p_mensagem_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE m record; v_url text; v_token text; v_req bigint; v_res jsonb;
BEGIN
  PERFORM public.fn__agente_assert_servico();
  SELECT msg.*, r.aciona INTO m
    FROM erp_agente_mensagem msg JOIN erp_agente_rotina r ON r.agente = msg.para
   WHERE msg.id = p_mensagem_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_nao_encontrada'); END IF;

  IF m.requer_ok_ceo AND m.ok_ceo_em IS NULL THEN
    v_res := jsonb_build_object('em', now(), 'acionou', false, 'motivo', 'aguarda_ok_ceo');
  ELSIF NOT m.aciona THEN
    v_res := jsonb_build_object('em', now(), 'acionou', false, 'motivo', 'agente_sem_acionamento');
  ELSE
    SELECT decrypted_secret INTO v_url   FROM vault.decrypted_secrets WHERE name = 'agente_rotina_url_'   || m.para;
    SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = 'agente_rotina_token_' || m.para;
    IF v_url IS NULL OR v_token IS NULL THEN
      v_res := jsonb_build_object('em', now(), 'acionou', false, 'motivo', 'rotina_nao_configurada_no_cofre');
    ELSE
      SELECT net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
          'Content-Type',      'application/json',
          'Authorization',     'Bearer ' || v_token,
          'anthropic-beta',    'experimental-cc-routine-2026-04-01',
          'anthropic-version', '2023-06-01'),
        body    := jsonb_build_object('text',
          'Nova mensagem ' || m.id::text || ' na caixa de ' || m.para || ' (de ' || m.de || '). '
          || 'Leia pelo canal protegido: SELECT fn_agente_caixa(''' || m.para || ''');'),
        timeout_milliseconds := 15000
      ) INTO v_req;
      v_res := jsonb_build_object('em', now(), 'acionou', true, 'request_id', v_req);
    END IF;
  END IF;

  UPDATE erp_agente_mensagem SET acionamento = v_res, atualizado_em = now() WHERE id = p_mensagem_id;
  RETURN jsonb_build_object('ok', true) || v_res;
END;
$function$;

-- gatilho: mensagem nova (sem OK pendente) ou OK do CEO registrado → aciona a rotina do destinatário
CREATE OR REPLACE FUNCTION public.fn_agente_mensagem_trg_acionar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT NEW.arquivada THEN PERFORM public.fn_agente_acionar(NEW.id); END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.requer_ok_ceo AND OLD.ok_ceo_em IS NULL AND NEW.ok_ceo_em IS NOT NULL AND NOT NEW.arquivada THEN
      PERFORM public.fn_agente_acionar(NEW.id);
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_agente_mensagem_acionar ON public.erp_agente_mensagem;
CREATE TRIGGER trg_agente_mensagem_acionar
  AFTER INSERT OR UPDATE OF ok_ceo_em ON public.erp_agente_mensagem
  FOR EACH ROW EXECUTE FUNCTION public.fn_agente_mensagem_trg_acionar();

-- ── funções de uso (todas pelo canal protegido) ────────────────────────────────────────────────────────────────────
-- Eng. Chefe (ou CEO) envia
CREATE OR REPLACE FUNCTION public.fn_agente_mensagem_enviar(p_para text, p_de text, p_tipo text, p_assunto text, p_corpo text,
                                                           p_requer_ok_ceo boolean DEFAULT false, p_enviado_por text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_ac jsonb;
BEGIN
  PERFORM public.fn__agente_assert_servico();
  INSERT INTO erp_agente_mensagem (para, de, tipo, assunto, corpo, requer_ok_ceo, enviado_por)
  VALUES (p_para, p_de, COALESCE(p_tipo, 'tarefa'), p_assunto, p_corpo, COALESCE(p_requer_ok_ceo, false),
          public.fn__agente_sessao(p_enviado_por))
  RETURNING id INTO v_id;
  SELECT acionamento INTO v_ac FROM erp_agente_mensagem WHERE id = v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'acionamento', v_ac);
END;
$function$;

-- Eng. Chefe registra o OK do CEO (dado no chat) → aciona a rotina
CREATE OR REPLACE FUNCTION public.fn_agente_mensagem_ok_ceo(p_mensagem_id uuid, p_origem text DEFAULT 'chat do Eng. Chefe',
                                                            p_registrado_por text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE m record;
BEGIN
  PERFORM public.fn__agente_assert_servico();
  SELECT * INTO m FROM erp_agente_mensagem WHERE id = p_mensagem_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_nao_encontrada'); END IF;
  IF NOT m.requer_ok_ceo THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_nao_pede_ok'); END IF;
  IF m.ok_ceo_em IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'ja_registrado', m.ok_ceo_em); END IF;
  UPDATE erp_agente_mensagem
     SET ok_ceo_em = now(), ok_ceo_origem = COALESCE(NULLIF(btrim(p_origem), ''), 'chat do Eng. Chefe'),
         ok_registrado_por = public.fn__agente_sessao(p_registrado_por), atualizado_em = now()
   WHERE id = p_mensagem_id;
  RETURN jsonb_build_object('ok', true, 'acionamento', (SELECT acionamento FROM erp_agente_mensagem WHERE id = p_mensagem_id));
END;
$function$;

-- Code lê a própria caixa (início de cada tarefa). As novas passam a "recebida".
CREATE OR REPLACE FUNCTION public.fn_agente_caixa(p_agente text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn__agente_assert_servico();
  IF NOT EXISTS (SELECT 1 FROM erp_agente_rotina WHERE agente = p_agente) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'agente_desconhecido');
  END IF;
  UPDATE erp_agente_mensagem SET status = 'recebida', recebida_em = now(), atualizado_em = now()
   WHERE para = p_agente AND status = 'nova' AND NOT arquivada;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'de', de, 'tipo', tipo, 'assunto', assunto, 'corpo', corpo, 'status', status,
           'requer_ok_ceo', requer_ok_ceo, 'ok_ceo_em', ok_ceo_em, 'ok_ceo_origem', ok_ceo_origem,
           'enviado_por', enviado_por, 'ok_registrado_por', ok_registrado_por,
           -- com OK pendente, o Code NÃO executa: só lê e aguarda
           'pode_executar', (NOT requer_ok_ceo OR ok_ceo_em IS NOT NULL),
           'criado_em', criado_em) ORDER BY criado_em), '[]'::jsonb)
    INTO v
    FROM erp_agente_mensagem
   WHERE para = p_agente AND status IN ('recebida','em_andamento') AND NOT arquivada;
  RETURN jsonb_build_object('ok', true, 'agente', p_agente, 'mensagens', v);
END;
$function$;

-- Code responde na própria mensagem: em_andamento → concluida | recusada (com BOX curto)
CREATE OR REPLACE FUNCTION public.fn_agente_mensagem_responder(p_mensagem_id uuid, p_agente text, p_status text,
                                                               p_resposta text DEFAULT NULL, p_pr_numero integer DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE m record;
BEGIN
  PERFORM public.fn__agente_assert_servico();
  SELECT * INTO m FROM erp_agente_mensagem WHERE id = p_mensagem_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_nao_encontrada'); END IF;
  IF m.para <> p_agente THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_de_outro_agente'); END IF;
  IF p_status NOT IN ('em_andamento','concluida','recusada') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status_invalido');
  END IF;
  IF m.status IN ('concluida','recusada') THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_encerrada'); END IF;
  IF p_status IN ('em_andamento','concluida') AND m.tipo = 'tarefa' AND m.requer_ok_ceo AND m.ok_ceo_em IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'aguarda_ok_ceo');
  END IF;
  IF p_status IN ('concluida','recusada') AND NULLIF(btrim(COALESCE(p_resposta, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'resposta_obrigatoria');
  END IF;
  UPDATE erp_agente_mensagem SET
    status        = p_status,
    resposta      = COALESCE(NULLIF(btrim(COALESCE(p_resposta, '')), ''), resposta),
    pr_numero     = COALESCE(p_pr_numero, pr_numero),
    recebida_em   = COALESCE(recebida_em, now()),
    iniciada_em   = CASE WHEN p_status = 'em_andamento' THEN COALESCE(iniciada_em, now()) ELSE iniciada_em END,
    concluida_em  = CASE WHEN p_status IN ('concluida','recusada') THEN now() ELSE concluida_em END,
    atualizado_em = now()
  WHERE id = p_mensagem_id;
  RETURN jsonb_build_object('ok', true, 'id', p_mensagem_id, 'status', p_status);
END;
$function$;

-- Eng. Chefe arquiva (nada é apagado)
CREATE OR REPLACE FUNCTION public.fn_agente_mensagem_arquivar(p_mensagem_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn__agente_assert_servico();
  UPDATE erp_agente_mensagem SET arquivada = true, atualizado_em = now() WHERE id = p_mensagem_id;
  RETURN jsonb_build_object('ok', FOUND);
END;
$function$;

-- Eng. Chefe confere o resultado do último disparo (código HTTP da rotina; sem cabeçalhos nem corpo do pedido)
CREATE OR REPLACE FUNCTION public.fn_agente_acionamento_status(p_mensagem_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ac jsonb; v_req bigint; r record;
BEGIN
  PERFORM public.fn__agente_assert_servico();
  SELECT acionamento INTO v_ac FROM erp_agente_mensagem WHERE id = p_mensagem_id;
  IF v_ac IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acionamento'); END IF;
  v_req := NULLIF(v_ac->>'request_id', '')::bigint;
  IF v_req IS NULL THEN RETURN jsonb_build_object('ok', true, 'acionamento', v_ac); END IF;
  SELECT status_code, timed_out, error_msg INTO r FROM net._http_response WHERE id = v_req;
  RETURN jsonb_build_object('ok', true, 'acionamento', v_ac,
    'http_status', r.status_code, 'timed_out', r.timed_out, 'erro_rede', r.error_msg);
END;
$function$;

-- todas só pelo canal protegido: nem anônimo nem usuário logado
REVOKE ALL ON FUNCTION public.fn__agente_assert_servico() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn__agente_sessao(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_agente_acionar(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_agente_mensagem_trg_acionar() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_agente_mensagem_enviar(text, text, text, text, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_agente_mensagem_ok_ceo(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_agente_caixa(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_agente_mensagem_responder(uuid, text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_agente_mensagem_arquivar(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_agente_acionamento_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__agente_assert_servico() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn__agente_sessao(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_agente_acionar(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_agente_mensagem_enviar(text, text, text, text, text, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_agente_mensagem_ok_ceo(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_agente_caixa(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_agente_mensagem_responder(uuid, text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_agente_mensagem_arquivar(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_agente_acionamento_status(uuid) TO service_role;
