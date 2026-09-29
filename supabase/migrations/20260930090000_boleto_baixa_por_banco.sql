-- Baixa automática de boleto ciente do BANCO (CEO 29/09 · aprovada; fecha o #297 quando o Bradesco entrar).
--
-- Antes (provado no dado 29/09): a consulta de pagamentos (/api/boleto/sync-liquidacao) só perguntava ao Sicoob e mandava
-- para ele os boletos de QUALQUER banco; fn_boleto_liquidar achava o título só por nosso_numero (sem banco) e baixava na
-- conta do Sicoob por padrão (p_provider='sicoob', p_banco_codigo='756'). Boleto Sicredi/Bradesco pago nunca baixava
-- sozinho (Sicredi: 8 boletos, 0 baixas automáticas; Bradesco: #297).
--
-- Agora:
--  1) fn_boleto_liquidar acha o título por EMPRESA + BANCO + NOSSO NÚMERO e baixa na conta do banco daquele boleto
--     (conexão ativa do mesmo banco_codigo). Banco é obrigatório — sem ele, não baixa nada.
--  2) Trava contra repetição: índice único (empresa, banco, nosso número) nos títulos ativos (0 repetidos em 29/09).
--  3) Registro de cada execução (agendada ou manual), por empresa e banco: erp_boleto_liquidacao_execucao.
--  4) Agendamento 2x ao dia, 7h e 13h de Brasília (10h e 16h UTC; Brasil sem horário de verão desde 2019), via pg_cron →
--     rota do app com a service key do Vault (mesmo padrão de fn_ponto_sync_dispatch). O botão manual continua.
--  5) Falha repetida (2 últimas execuções de uma empresa/banco com erro) ou agendamento que não voltou → alerta no briefing.
-- Guarda de sobrepagamento/duplicidade da baixa continua em fn_receber_baixar_pagamento (erp_receber_baixa).

-- 1) baixa por empresa + banco + nosso número ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_boleto_liquidar(p_company_id uuid, p_nosso_numero text, p_data_pagamento date, p_valor_pago numeric DEFAULT NULL::numeric, p_provider_raw jsonb DEFAULT '{}'::jsonb, p_provider text DEFAULT NULL::text, p_banco_codigo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_receber record; v_conta_id uuid; v_baixa jsonb;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;
  -- sem banco não há como saber qual título é (o mesmo nosso número pode existir em dois bancos)
  IF NULLIF(btrim(COALESCE(p_banco_codigo,'')),'') IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'banco_obrigatorio', 'nosso_numero', p_nosso_numero);
  END IF;

  SELECT id, status, valor, boleto_status INTO v_receber
  FROM erp_receber
  WHERE company_id = p_company_id AND boleto_banco_codigo = p_banco_codigo AND boleto_nosso_numero = p_nosso_numero
    AND deleted_at IS NULL
  ORDER BY boleto_emitido_em DESC NULLS LAST LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'recebivel_nao_encontrado', 'nosso_numero', p_nosso_numero, 'banco_codigo', p_banco_codigo);
  END IF;
  IF v_receber.boleto_status = 'liquidado' OR v_receber.status IN ('pago','recebido') THEN
    RETURN jsonb_build_object('sucesso', true, 'ja_liquidado', true, 'receber_id', v_receber.id);
  END IF;

  -- conta do banco DESTE boleto (conexão ativa do mesmo banco; produção primeiro)
  SELECT banco_conta_id INTO v_conta_id
  FROM erp_banco_provider_config
  WHERE company_id = p_company_id AND banco_codigo = p_banco_codigo AND ativo = true
  ORDER BY (ambiente = 'producao') DESC, updated_at DESC NULLS LAST LIMIT 1;

  v_baixa := public.fn_receber_baixar_pagamento(
    p_receber_id := v_receber.id, p_data_pagamento := p_data_pagamento,
    p_conta_bancaria_id := v_conta_id, p_forma_pagamento := 'BOLETO',
    p_valor_pago := COALESCE(p_valor_pago, v_receber.valor), p_origem := 'boleto');

  IF COALESCE((v_baixa->>'sucesso')::boolean, false) = false THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'falha_baixa', 'detalhe', v_baixa, 'receber_id', v_receber.id);
  END IF;

  UPDATE erp_receber SET boleto_status = 'liquidado', boleto_pago_em = NOW() WHERE id = v_receber.id;

  IF p_provider_raw <> '{}'::jsonb THEN
    BEGIN
      INSERT INTO public.erp_banco_sync_log (company_id, banco_codigo, provider, tipo, status, qtd, mensagem, payload_resumo)
      VALUES (p_company_id, p_banco_codigo, p_provider, 'boleto_liquidar', 'ok', 1,
        format('nu=%s pago em %s', p_nosso_numero, p_data_pagamento), p_provider_raw);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'receber_id', v_receber.id, 'nosso_numero', p_nosso_numero,
    'banco_codigo', p_banco_codigo, 'conta_bancaria_id', v_conta_id, 'baixa', v_baixa);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_boleto_liquidar(uuid, text, date, numeric, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_boleto_liquidar(uuid, text, date, numeric, jsonb, text, text) TO authenticated, service_role;

-- 2) trava contra repetição -------------------------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_receber_boleto_banco_nosso_numero
  ON public.erp_receber (company_id, boleto_banco_codigo, boleto_nosso_numero)
  WHERE boleto_nosso_numero IS NOT NULL AND deleted_at IS NULL;

-- 3) registro de execuções ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_boleto_liquidacao_execucao (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id      uuid NOT NULL,
  origem       text NOT NULL CHECK (origem IN ('agendado','manual')),
  company_id   uuid REFERENCES public.companies(id) ON DELETE CASCADE,   -- NULL = linha do disparo agendado (o lote)
  banco_codigo text,
  provider     text,
  status       text NOT NULL CHECK (status IN ('disparado','ok','parcial','erro','sem_boletos')),
  consultados  int NOT NULL DEFAULT 0,
  liquidados   int NOT NULL DEFAULT 0,
  erros        jsonb NOT NULL DEFAULT '[]'::jsonb,
  mensagem     text,
  usuario_id   uuid,
  iniciado_em  timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz
);
CREATE INDEX IF NOT EXISTS ix_boleto_liq_exec_empresa_banco ON public.erp_boleto_liquidacao_execucao (company_id, banco_codigo, iniciado_em DESC);
CREATE INDEX IF NOT EXISTS ix_boleto_liq_exec_lote ON public.erp_boleto_liquidacao_execucao (lote_id);
ALTER TABLE public.erp_boleto_liquidacao_execucao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS boleto_liq_exec_select ON public.erp_boleto_liquidacao_execucao;
CREATE POLICY boleto_liq_exec_select ON public.erp_boleto_liquidacao_execucao FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
REVOKE ALL ON public.erp_boleto_liquidacao_execucao FROM anon;
GRANT SELECT ON public.erp_boleto_liquidacao_execucao TO authenticated;
GRANT ALL ON public.erp_boleto_liquidacao_execucao TO service_role;

-- grava uma execução (por empresa e banco) ou fecha o lote do disparo agendado (company NULL). Só o servidor.
CREATE OR REPLACE FUNCTION public.fn_boleto_liquidacao_registrar(p_lote_id uuid, p_origem text, p_company_id uuid, p_banco_codigo text,
  p_provider text, p_status text, p_consultados int DEFAULT 0, p_liquidados int DEFAULT 0, p_erros jsonb DEFAULT '[]'::jsonb,
  p_mensagem text DEFAULT NULL, p_usuario_id uuid DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF p_company_id IS NULL THEN
    -- fecha a linha do disparo (lote) — se não existir (execução manual), cria
    UPDATE erp_boleto_liquidacao_execucao SET status = p_status, consultados = COALESCE(p_consultados,0),
      liquidados = COALESCE(p_liquidados,0), erros = COALESCE(p_erros,'[]'::jsonb), mensagem = p_mensagem, concluido_em = now()
     WHERE lote_id = p_lote_id AND company_id IS NULL RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  INSERT INTO erp_boleto_liquidacao_execucao (lote_id, origem, company_id, banco_codigo, provider, status, consultados, liquidados,
    erros, mensagem, usuario_id, concluido_em)
  VALUES (p_lote_id, p_origem, p_company_id, p_banco_codigo, p_provider, p_status, COALESCE(p_consultados,0), COALESCE(p_liquidados,0),
    COALESCE(p_erros,'[]'::jsonb), p_mensagem, p_usuario_id, CASE WHEN p_status = 'disparado' THEN NULL ELSE now() END)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_boleto_liquidacao_registrar(uuid, text, uuid, text, text, text, int, int, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_boleto_liquidacao_registrar(uuid, text, uuid, text, text, text, int, int, jsonb, text, uuid) TO service_role;

-- saúde para o briefing: falha repetida por empresa/banco e agendamento que não voltou
CREATE OR REPLACE FUNCTION public.fn_boleto_liquidacao_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_falhas jsonb; v_sem_retorno jsonb; v_ultima jsonb;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR is_admin()) THEN
    RAISE EXCEPTION 'Acesso restrito à equipe PS' USING errcode='42501';
  END IF;
  -- as 2 últimas execuções (concluídas) de cada empresa/banco com erro
  SELECT COALESCE(jsonb_agg(jsonb_build_object('empresa', c.nome_fantasia, 'company_id', t.company_id, 'banco_codigo', t.banco_codigo,
           'ultima_mensagem', t.ultima_msg, 'desde', t.desde) ORDER BY c.nome_fantasia), '[]'::jsonb)
    INTO v_falhas
  FROM (
    SELECT company_id, banco_codigo,
           (array_agg(mensagem ORDER BY iniciado_em DESC))[1] ultima_msg, min(iniciado_em) desde
      FROM (SELECT *, row_number() OVER (PARTITION BY company_id, banco_codigo ORDER BY iniciado_em DESC) rn
              FROM erp_boleto_liquidacao_execucao WHERE company_id IS NOT NULL AND status <> 'disparado') x
     WHERE rn <= 2
     GROUP BY company_id, banco_codigo
    HAVING count(*) = 2 AND bool_and(status = 'erro')
  ) t JOIN companies c ON c.id = t.company_id;
  -- disparos agendados das últimas 48h que não voltaram em 2 horas (as 2 últimas tentativas)
  SELECT CASE WHEN count(*) = 2 AND bool_and(status = 'disparado' OR status = 'erro')
              THEN jsonb_agg(jsonb_build_object('lote_id', lote_id, 'iniciado_em', iniciado_em, 'status', status)) ELSE '[]'::jsonb END
    INTO v_sem_retorno
  FROM (SELECT lote_id, iniciado_em, status FROM erp_boleto_liquidacao_execucao
         WHERE company_id IS NULL AND origem = 'agendado' AND iniciado_em > now() - interval '48 hours'
           AND iniciado_em < now() - interval '2 hours'
         ORDER BY iniciado_em DESC LIMIT 2) y;
  SELECT jsonb_build_object('em', max(iniciado_em), 'liquidados_24h', COALESCE(sum(liquidados) FILTER (WHERE iniciado_em > now() - interval '24 hours' AND company_id IS NOT NULL), 0))
    INTO v_ultima FROM erp_boleto_liquidacao_execucao;
  RETURN jsonb_build_object('ok', jsonb_array_length(v_falhas) = 0 AND jsonb_array_length(v_sem_retorno) = 0,
    'falhas_repetidas', v_falhas, 'agendamento_sem_retorno', v_sem_retorno, 'ultima_execucao', v_ultima);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_boleto_liquidacao_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_boleto_liquidacao_status() TO authenticated, service_role;

-- 4) agendamento 7h e 13h (Brasília) → rota do app -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_boleto_liquidacao_dispatch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_service_role text; v_lote uuid := gen_random_uuid(); v_request_id bigint;
  v_url text := 'https://erp-psgestao.vercel.app/api/boleto/sync-liquidacao';
BEGIN
  PERFORM public.fn_boleto_liquidacao_registrar(v_lote, 'agendado', NULL, NULL, NULL, 'disparado');
  SELECT decrypted_secret INTO v_service_role FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER';
  IF v_service_role IS NULL THEN
    PERFORM public.fn_boleto_liquidacao_registrar(v_lote, 'agendado', NULL, NULL, NULL, 'erro', 0, 0, '[]'::jsonb, 'service_role ausente no Vault');
    RETURN jsonb_build_object('ok', false, 'erro', 'service_role ausente no vault', 'lote_id', v_lote);
  END IF;
  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_role),
    body := jsonb_build_object('origem', 'agendado', 'lote_id', v_lote),
    timeout_milliseconds := 300000
  ) INTO v_request_id;
  RETURN jsonb_build_object('ok', true, 'lote_id', v_lote, 'request_id', v_request_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_boleto_liquidacao_dispatch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_boleto_liquidacao_dispatch() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'boleto-liquidacao-7h-13h') THEN
    PERFORM cron.unschedule('boleto-liquidacao-7h-13h');
  END IF;
END $$;
SELECT cron.schedule('boleto-liquidacao-7h-13h', '0 10,16 * * *', $cron$ SELECT public.fn_boleto_liquidacao_dispatch(); $cron$);

-- 5) alerta no briefing (acrescenta ao fn_briefing_sessao ATUAL, sem reescrever o resto; idempotente) --------------------
DO $patch$
DECLARE d text; v_bloco text;
BEGIN
  d := pg_get_functiondef('public.fn_briefing_sessao()'::regprocedure);
  IF position('boleto_liquidacao' in d) = 0 THEN
    v_bloco := $b$  -- 30/09: baixa automática de boleto (7h/13h) — falha repetida por empresa/banco ou agendamento sem retorno
  v_result := v_result || jsonb_build_object('boleto_liquidacao', public.fn_boleto_liquidacao_status());
  IF NOT coalesce((v_result->'boleto_liquidacao'->>'ok')::boolean, true) THEN
    v_result := jsonb_set(v_result, '{alertas_pendentes_para_ceo,baixa_boleto_falhando}', jsonb_build_object(
      'falhas_repetidas', v_result->'boleto_liquidacao'->'falhas_repetidas',
      'agendamento_sem_retorno', v_result->'boleto_liquidacao'->'agendamento_sem_retorno',
      'acao', 'Baixa automática de boleto falhou 2 vezes seguidas: ver erp_boleto_liquidacao_execucao (credencial do banco?)'), true);
  END IF;
$b$;
    IF position(E'  RETURN v_result;\nEND;' in d) = 0 THEN
      RAISE EXCEPTION 'fn_briefing_sessao mudou de forma: ponto de inserção não encontrado';
    END IF;
    d := replace(d, E'  RETURN v_result;\nEND;', v_bloco || E'  RETURN v_result;\nEND;');
    EXECUTE d;
  END IF;
END $patch$;
