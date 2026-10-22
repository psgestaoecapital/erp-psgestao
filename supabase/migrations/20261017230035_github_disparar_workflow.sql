-- Disparo de workflow do GitHub pelo banco (CEO 17/10, pedido do Eng. Chefe 434d0e6e · RD-97, aditivo).
-- O CEO gravou no cofre (vault) a chave `github_actions_dispatch_token` (fine-grained, SÓ Actions read/write, SÓ este repo).
-- Esta migration entrega:
--   (1) erp_github_workflow_permitido — LISTA FECHADA: só estes workflows podem ser disparados, com as regras dos inputs;
--   (2) fn_github_disparar_workflow — lê a chave só DENTRO da função (nunca devolve nem loga), chama o dispatch via pg_net;
--   (3) erp_github_disparo_log — quem pediu, workflow, inputs, hora, status HTTP e id da execução (nunca a chave);
--   (4) fn_github_disparo_coletar (pg_cron 1/min) — pg_net é assíncrono: lê a resposta do GitHub, grava status/run e o
--       cabeçalho `github-authentication-token-expiration` em erp_github_token_validade;
--   (5) fn_github_token_vigia (pg_cron diário) — avisa o CEO (briefing + sino/celular + e-mail) 15 dias antes de a chave
--       vencer (sem expiração informada: lembrete de revisão anual);
--   (6) fn_github_vigia_agir — ações automáticas do manual do vigia: "vaga suja → recriar" e "aceitação abortada por
--       infra → re-rodar" (limite de 1 por situação a cada 30 min; registra em erp_esteira_vigia_acao).
-- Execução SÓ da conexão de serviço (REVOKE PUBLIC/anon/authenticated); nenhum usuário do app chama. RD-79/RD-52.

-- ── (1) lista fechada ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_github_workflow_permitido (
  workflow        text PRIMARY KEY CHECK (workflow ~ '^[a-z0-9][a-z0-9._-]*\.yml$'),
  descricao       text    NOT NULL,
  refs_permitidos text[]  NOT NULL DEFAULT ARRAY['main'],
  -- {"vaga": {"enum": ["0","1"], "obrigatorio": false}} — input fora desta lista é recusado
  inputs_regras   jsonb   NOT NULL DEFAULT '{}'::jsonb,
  situacao_vigia  text    UNIQUE,           -- 'vaga_suja' | 'aceitacao_abortada_infra' (ação automática do vigia)
  ativo           boolean NOT NULL DEFAULT true,
  criado_em       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.erp_github_workflow_permitido IS
  'Lista FECHADA de workflows que o banco pode disparar (fn_github_disparar_workflow). Fora daqui = recusa. Escrita só por migration/service_role.';

INSERT INTO public.erp_github_workflow_permitido (workflow, descricao, inputs_regras, situacao_vigia) VALUES
  ('montar-banco-testes.yml', 'Montar/recriar o banco de testes da vaga (0 ou 1)',
     '{"vaga":{"enum":["0","1"]},"recriar":{"enum":["true","false"]}}'::jsonb, 'vaga_suja'),
  ('aceitacao-pos-migration.yml', 'Re-rodar a aceitação @pos-migration (produção, só leitura)',
     '{}'::jsonb, 'aceitacao_abortada_infra'),
  ('aceitacao-main.yml', 'Re-rodar a aceitação da main (banco de testes)', '{}'::jsonb, NULL),
  ('reconciliar-vaga.yml', 'Restaurar a vaga contaminada ao estado da produção',
     '{"vaga":{"enum":["0","1"]}}'::jsonb, NULL),
  ('auditor-playwright.yml', 'Jornadas/auditoria do Code-Auditor (DOM)', '{}'::jsonb, NULL),
  ('jornadas-revenda.yml', 'Jornadas da Revenda (Playwright)', '{}'::jsonb, NULL),
  ('dispatch-ping.yml', 'Diagnóstico inofensivo (só imprime uma linha) — prova do disparo', '{}'::jsonb, NULL)
ON CONFLICT (workflow) DO NOTHING;

-- ── (3) log de disparo e (4) validade da chave ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_github_disparo_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quando      timestamptz NOT NULL DEFAULT now(),
  pedido_por  text        NOT NULL,                  -- identificador de quem pediu (ex.: gilberto-esteira, vigia:vaga_suja)
  papel_db    text        NOT NULL DEFAULT current_user,
  workflow    text        NOT NULL,
  ref         text,
  inputs      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  resultado   text        NOT NULL,                  -- enviado | recusado | sem_chave
  motivo      text,
  request_id  bigint,                                -- id do pedido no pg_net
  status_http integer,                               -- preenchido pelo coletor (204/200 = ok)
  run_id      bigint,                                -- id da execução criada (quando o GitHub devolve)
  run_url     text,
  erro        text
);
CREATE INDEX IF NOT EXISTS erp_github_disparo_log_quando_idx ON public.erp_github_disparo_log (quando DESC);
CREATE INDEX IF NOT EXISTS erp_github_disparo_log_pend_idx ON public.erp_github_disparo_log (request_id) WHERE status_http IS NULL AND request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.erp_github_token_validade (
  id               integer PRIMARY KEY CHECK (id = 1),
  expira_em        timestamptz,
  sem_expiracao    boolean     NOT NULL DEFAULT false,
  verificado_em    timestamptz NOT NULL DEFAULT now(),
  revisado_em      timestamptz NOT NULL DEFAULT now(),   -- última revisão humana (lembrete anual se não expira)
  alertado_chave   text                                  -- episódio já avisado (expira_em ou 'anual-AAAA')
);

ALTER TABLE public.erp_github_workflow_permitido ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_github_disparo_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_github_token_validade     ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_github_workflow_permitido FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.erp_github_disparo_log        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.erp_github_token_validade     FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.erp_github_disparo_log TO authenticated;       -- equipe PS vê o rastro (sem a chave)
DROP POLICY IF EXISTS erp_github_disparo_log_sel_ps ON public.erp_github_disparo_log;
CREATE POLICY erp_github_disparo_log_sel_ps ON public.erp_github_disparo_log
  FOR SELECT TO authenticated USING (public.fn_dev_painel_pode_ver());

-- ── (2) o disparo ─────────────────────────────────────────────────────────────────────────────────────────────────
-- ci-sem-guarda: fn_github_disparar_workflow — esteira/infra, SEM dado de cliente nem company_id; execução fechada à
-- conexão de serviço (REVOKE PUBLIC/anon/authenticated) e a função ainda recusa qualquer sessão de usuário (auth.uid()).
CREATE OR REPLACE FUNCTION public.fn_github_disparar_workflow(
  p_workflow text,
  p_ref      text  DEFAULT 'main',
  p_inputs   jsonb DEFAULT '{}'::jsonb,
  p_origem   text  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $fn$
DECLARE
  v_perm   public.erp_github_workflow_permitido%ROWTYPE;
  v_origem text := left(coalesce(nullif(btrim(p_origem), ''), 'nao-informado'), 80);
  v_inputs jsonb := coalesce(p_inputs, '{}'::jsonb);
  v_k      text;
  v_v      jsonb;
  v_regra  jsonb;
  v_token  text;
  v_req    bigint;
  v_log    bigint;
  v_motivo text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'sem_acesso: disparo de workflow é só da conexão de serviço';
  END IF;

  SELECT * INTO v_perm FROM public.erp_github_workflow_permitido WHERE workflow = p_workflow AND ativo;
  IF NOT FOUND THEN
    v_motivo := 'workflow fora da lista permitida';
  ELSIF p_ref IS NULL OR NOT (p_ref = ANY (v_perm.refs_permitidos)) THEN
    v_motivo := 'ref não permitida para este workflow';
  ELSIF jsonb_typeof(v_inputs) <> 'object' THEN
    v_motivo := 'inputs deve ser um objeto json';
  ELSE
    FOR v_k, v_v IN SELECT key, value FROM jsonb_each(v_inputs) LOOP
      v_regra := v_perm.inputs_regras -> v_k;
      IF v_regra IS NULL THEN v_motivo := 'input não permitido: ' || left(v_k, 40); EXIT; END IF;
      IF jsonb_typeof(v_v) NOT IN ('string', 'number', 'boolean') THEN v_motivo := 'input inválido: ' || left(v_k, 40); EXIT; END IF;
      IF v_regra ? 'enum' AND NOT (v_regra -> 'enum') @> to_jsonb(v_v #>> '{}') THEN
        v_motivo := 'valor inválido para ' || left(v_k, 40) || ' (permitidos: ' || (v_regra ->> 'enum') || ')';
        EXIT;
      END IF;
    END LOOP;
    IF v_motivo IS NULL THEN
      SELECT 'input obrigatório ausente: ' || r.key INTO v_motivo
        FROM jsonb_each(v_perm.inputs_regras) r
       WHERE coalesce((r.value ->> 'obrigatorio')::boolean, false) AND NOT (v_inputs ? r.key) LIMIT 1;
    END IF;
  END IF;

  IF v_motivo IS NOT NULL THEN
    INSERT INTO public.erp_github_disparo_log (pedido_por, workflow, ref, inputs, resultado, motivo)
    VALUES (v_origem, left(coalesce(p_workflow, ''), 120), left(p_ref, 120),
            CASE WHEN jsonb_typeof(v_inputs) = 'object' THEN v_inputs ELSE '{}'::jsonb END, 'recusado', v_motivo);
    RETURN jsonb_build_object('ok', false, 'recusado', true, 'motivo', v_motivo);
  END IF;

  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = 'github_actions_dispatch_token';
  IF v_token IS NULL OR v_token = '' THEN
    INSERT INTO public.erp_github_disparo_log (pedido_por, workflow, ref, inputs, resultado, motivo)
    VALUES (v_origem, p_workflow, p_ref, v_inputs, 'sem_chave', 'chave github_actions_dispatch_token ausente no cofre');
    RETURN jsonb_build_object('ok', false, 'motivo', 'chave ausente no cofre');
  END IF;

  v_req := net.http_post(
    url     := 'https://api.github.com/repos/psgestaoecapital/erp-psgestao/actions/workflows/' || p_workflow || '/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'ps-gestao-esteira',
      'Content-Type', 'application/json'),
    body    := jsonb_build_object('ref', p_ref, 'inputs', v_inputs, 'return_run_details', true),
    timeout_milliseconds := 15000);

  INSERT INTO public.erp_github_disparo_log (pedido_por, workflow, ref, inputs, resultado, request_id)
  VALUES (v_origem, p_workflow, p_ref, v_inputs, 'enviado', v_req)
  RETURNING id INTO v_log;

  RETURN jsonb_build_object('ok', true, 'log_id', v_log, 'request_id', v_req,
    'obs', 'envio assíncrono: status HTTP e id da execução entram em erp_github_disparo_log em até 1 min');
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_github_disparar_workflow(text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_github_disparar_workflow(text, text, jsonb, text) TO service_role;

-- ── (4) coletor da resposta (pg_net é assíncrono) ─────────────────────────────────────────────────────────────────
-- ci-sem-guarda: fn_github_disparo_coletar — rotina interna (pg_cron), sem parâmetro e só service_role.
CREATE OR REPLACE FUNCTION public.fn_github_disparo_coletar()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $fn$
DECLARE
  r       RECORD;
  v_n     integer := 0;
  v_body  jsonb;
  v_exp   text;
  v_ts    timestamptz;
  v_sem   boolean;
BEGIN
  FOR r IN
    SELECT l.id, l.quando, h.status_code, h.content, h.headers, h.error_msg
      FROM public.erp_github_disparo_log l
      LEFT JOIN net._http_response h ON h.id = l.request_id
     WHERE l.status_http IS NULL AND l.request_id IS NOT NULL AND l.quando > now() - interval '2 hours'
     LIMIT 50
  LOOP
    IF r.status_code IS NULL AND r.error_msg IS NULL THEN
      IF r.quando < now() - interval '10 minutes' THEN
        UPDATE public.erp_github_disparo_log SET status_http = 0, erro = 'sem resposta do GitHub em 10 min' WHERE id = r.id;
        v_n := v_n + 1;
      END IF;
      CONTINUE;
    END IF;

    BEGIN v_body := r.content::jsonb; EXCEPTION WHEN OTHERS THEN v_body := NULL; END;
    UPDATE public.erp_github_disparo_log
       SET status_http = coalesce(r.status_code, 0),
           run_id  = CASE WHEN jsonb_typeof(v_body) = 'object' THEN (v_body ->> 'workflow_run_id')::bigint END,
           run_url = CASE WHEN jsonb_typeof(v_body) = 'object' THEN v_body ->> 'html_url' END,
           erro    = CASE WHEN coalesce(r.status_code, 0) BETWEEN 200 AND 299 THEN NULL
                          ELSE left(coalesce(r.error_msg, CASE WHEN jsonb_typeof(v_body) = 'object' THEN v_body ->> 'message' END, 'falha'), 300) END
     WHERE id = r.id;
    v_n := v_n + 1;

    -- validade da chave: cabeçalho github-authentication-token-expiration (sem ele = chave sem expiração)
    IF r.status_code IN (200, 204) AND r.headers IS NOT NULL THEN
      SELECT value INTO v_exp FROM jsonb_each_text(r.headers) WHERE lower(key) = 'github-authentication-token-expiration' LIMIT 1;
      v_sem := v_exp IS NULL;
      v_ts := NULL;
      IF v_exp IS NOT NULL THEN
        BEGIN v_ts := replace(v_exp, ' UTC', ' +00')::timestamptz; EXCEPTION WHEN OTHERS THEN v_ts := NULL; END;
      END IF;
      INSERT INTO public.erp_github_token_validade (id, expira_em, sem_expiracao, verificado_em)
      VALUES (1, v_ts, v_sem, now())
      ON CONFLICT (id) DO UPDATE
        SET expira_em = EXCLUDED.expira_em, sem_expiracao = EXCLUDED.sem_expiracao, verificado_em = now();
    END IF;
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_github_disparo_coletar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_github_disparo_coletar() TO service_role;

-- ── (5) vigia da validade da chave ────────────────────────────────────────────────────────────────────────────────
-- ci-sem-guarda: fn_github_token_vigia — rotina interna de alerta (pg_cron), sem parâmetro e só service_role.
CREATE OR REPLACE FUNCTION public.fn_github_token_vigia()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  t       public.erp_github_token_validade%ROWTYPE;
  v_ceo   uuid := '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb';  -- conta CEO (gilberto.paravizi@gmail.com)
  v_email text;
  v_comp  uuid;
  v_chave text;
  v_msg   text;
BEGIN
  SELECT * INTO t FROM public.erp_github_token_validade WHERE id = 1;
  IF NOT FOUND THEN RETURN; END IF;

  IF t.expira_em IS NOT NULL AND t.expira_em - now() <= interval '15 days' THEN
    v_chave := 'exp-' || to_char(t.expira_em, 'YYYYMMDD');
    v_msg := 'A chave do GitHub usada pelo banco para disparar workflows (github_actions_dispatch_token) '
          || CASE WHEN t.expira_em <= now() THEN 'VENCEU em ' ELSE 'vence em ' END
          || to_char(t.expira_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
          || '. Gere outra (fine-grained, só Actions read/write, só o repo erp-psgestao) e grave no cofre com o mesmo nome.';
  ELSIF t.sem_expiracao AND t.revisado_em < now() - interval '365 days' THEN
    v_chave := 'anual-' || to_char(now(), 'YYYY');
    v_msg := 'Revisão anual: a chave github_actions_dispatch_token não tem data de expiração. Confira se ainda é necessária e se o escopo continua só Actions/erp-psgestao.';
  ELSE
    RETURN;
  END IF;
  IF t.alertado_chave IS NOT DISTINCT FROM v_chave THEN RETURN; END IF;   -- já avisado neste episódio

  INSERT INTO erp_truth_alerts (rule_id, severity, area, tipo_divergencia, mensagem, recomendacao, status)
  VALUES ('github_dispatch_token_validade', 'high', 'dev', 'chave_github_vencendo', v_msg,
          'Cofre › github_actions_dispatch_token', 'novo');

  SELECT email INTO v_email FROM users WHERE id = v_ceo;
  SELECT company_id INTO v_comp FROM user_companies WHERE user_id = v_ceo LIMIT 1;
  IF v_comp IS NOT NULL THEN
    INSERT INTO erp_notificacao_usuario (company_id, destinatario_id, tipo, titulo, mensagem, link, origem_tipo)
    VALUES (v_comp, v_ceo, 'alerta_ci', 'Chave do GitHub da esteira vencendo', v_msg,
            'https://github.com/settings/personal-access-tokens', 'github_token_validade');
  END IF;
  IF v_email IS NOT NULL THEN
    PERFORM fn_enviar_email(v_email, 'contrato_evento', jsonb_build_object(
      'assunto', 'Chave do GitHub da esteira vencendo - PS Gestao',
      'titulo_email', 'Chave do GitHub da esteira',
      'corpo', v_msg,
      'cta', 'Abrir tokens do GitHub',
      'link', 'https://github.com/settings/personal-access-tokens',
      'idempotency_key', 'github-token-' || v_chave));
  END IF;

  UPDATE public.erp_github_token_validade SET alertado_chave = v_chave WHERE id = 1;
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_github_token_vigia() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_github_token_vigia() TO service_role;

-- ── (6) ações automáticas do vigia ────────────────────────────────────────────────────────────────────────────────
-- ci-sem-guarda: fn_github_vigia_agir — esteira/infra sem dado de cliente; só service_role e só a lista fechada.
CREATE OR REPLACE FUNCTION public.fn_github_vigia_agir(p_situacao text, p_detalhe jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $fn$
DECLARE
  v_wf     text;
  v_vaga   text := coalesce(p_detalhe ->> 'vaga', '0');
  v_inputs jsonb := '{}'::jsonb;
  v_acao   text;
  v_chave  text;
  v_res    jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'sem_acesso: vigia é só da conexão de serviço'; END IF;
  SELECT workflow INTO v_wf FROM public.erp_github_workflow_permitido WHERE situacao_vigia = p_situacao AND ativo;
  IF v_wf IS NULL THEN RETURN jsonb_build_object('ok', false, 'motivo', 'situação sem ação do vigia'); END IF;

  IF p_situacao = 'vaga_suja' THEN
    v_acao := 'recriar-vaga';
    v_inputs := jsonb_build_object('vaga', v_vaga, 'recriar', 'true');
  ELSE
    v_acao := 'rerun-aceitacao-infra';
  END IF;

  -- no máx. 1 ação por situação/vaga a cada 30 min (não vira laço se a infra continuar ruim)
  v_chave := v_acao || ':' || v_vaga || ':' || to_char(date_trunc('hour', now()) + floor(extract(minute FROM now()) / 30) * interval '30 minutes', 'YYYYMMDDHH24MI');
  INSERT INTO public.erp_esteira_vigia_acao (acao, alvo, resultado, detalhe, ciclo_chave)
  VALUES (v_acao, v_wf, 'ok', coalesce(p_detalhe, '{}'::jsonb), v_chave)
  ON CONFLICT (ciclo_chave) WHERE ciclo_chave IS NOT NULL DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'no_op', true, 'motivo', 'já agiu nesta janela de 30 min'); END IF;

  v_res := public.fn_github_disparar_workflow(v_wf, 'main', v_inputs, 'vigia:' || p_situacao);
  IF NOT coalesce((v_res ->> 'ok')::boolean, false) THEN
    UPDATE public.erp_esteira_vigia_acao SET resultado = 'falhou', detalhe = detalhe || jsonb_build_object('disparo', v_res)
     WHERE ciclo_chave = v_chave;
  END IF;
  RETURN v_res;
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_github_vigia_agir(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_github_vigia_agir(text, jsonb) TO service_role;

-- ── agenda (pg_cron, idempotente) ─────────────────────────────────────────────────────────────────────────────────
SELECT cron.unschedule('github-disparo-coletar') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'github-disparo-coletar');
SELECT cron.schedule('github-disparo-coletar', '* * * * *', $cron$SELECT public.fn_github_disparo_coletar()$cron$);
SELECT cron.unschedule('github-token-vigia') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'github-token-vigia');
SELECT cron.schedule('github-token-vigia', '0 11 * * *', $cron$SELECT public.fn_github_token_vigia()$cron$);
