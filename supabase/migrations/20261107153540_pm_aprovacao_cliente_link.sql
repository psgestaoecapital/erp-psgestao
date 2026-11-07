-- PDCA P&M · /dashboard/pm/aprovacao — a tela promete "Aprovação do CLIENTE" mas quem aprovava era o
-- operador da agência; não havia link público para o cliente aprovar o job (análogo a /p/orcamento/[token]).
-- Esta migration é ADITIVA e idempotente: NÃO altera nem apaga dado de cliente.
--   1) colunas de link + trilha LGPD na agency_jobs;
--   2) RPCs por token: gerar link (interno), ler (público), aprovar (público), solicitar ajustes (público);
--   3) grants (anon só nas RPCs de token, guardadas; nunca acesso direto à tabela);
--   4) chaves RD-95 "?" da ação nova na tela interna.
-- Segurança: as RPCs públicas são SECURITY DEFINER e SÓ enxergam o job casado pelo token (nunca outro job/empresa);
-- a trilha LGPD grava quem aprovou, quando, origem, IP, user-agent e um hash de integridade.

BEGIN;

-- 1) Colunas aditivas (link + trilha LGPD). Sem default destrutivo, sem backfill de dado de cliente.
ALTER TABLE public.agency_jobs
  ADD COLUMN IF NOT EXISTS aprovacao_token          text,
  ADD COLUMN IF NOT EXISTS aprovacao_token_em       timestamptz,
  ADD COLUMN IF NOT EXISTS aprovacao_origem         text,   -- 'cliente' (link) | 'interno' (registrado por fora)
  ADD COLUMN IF NOT EXISTS aprovado_por_cliente     text,
  ADD COLUMN IF NOT EXISTS aprovado_em_cliente      timestamptz,
  ADD COLUMN IF NOT EXISTS aprovacao_ip             text,
  ADD COLUMN IF NOT EXISTS aprovacao_user_agent     text,
  ADD COLUMN IF NOT EXISTS aprovacao_ajustes_texto  text,
  ADD COLUMN IF NOT EXISTS aprovacao_ajustes_em     timestamptz;

-- Token é único quando presente (o link é a chave de acesso; colisão nunca expõe outro job).
CREATE UNIQUE INDEX IF NOT EXISTS uq_agency_jobs_aprovacao_token
  ON public.agency_jobs (aprovacao_token) WHERE aprovacao_token IS NOT NULL;

-- 2a) INTERNO: gera (ou reaproveita) o token do job e devolve. Guarda por empresa (RD-45). Idempotente.
CREATE OR REPLACE FUNCTION public.fn_pm_job_gerar_link_aprovacao(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp   uuid;
  v_status text;
  v_token  text;
  v_uid    uuid := auth.uid();
BEGIN
  SELECT company_id, status, aprovacao_token
    INTO v_comp, v_status, v_token
    FROM agency_jobs WHERE id = p_job_id AND excluido_em IS NULL;
  IF v_comp IS NULL OR v_comp NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem permissao');
  END IF;

  IF v_token IS NULL THEN
    v_token := encode(extensions.digest(gen_random_uuid()::text || clock_timestamp()::text || random()::text, 'sha256'), 'hex');
    UPDATE agency_jobs
       SET aprovacao_token = v_token, aprovacao_token_em = now(), updated_at = now()
     WHERE id = p_job_id;
    INSERT INTO public.audit_log_global
      (company_id, user_id, user_email, tabela, registro_id, acao, valor_novo)
    VALUES
      (v_comp, v_uid, (SELECT email FROM public.users WHERE id = v_uid),
       'agency_jobs', p_job_id::text, 'job_link_aprovacao_gerado',
       jsonb_build_object('origem', 'link_cliente'));
  END IF;

  RETURN jsonb_build_object('ok', true, 'token', v_token, 'status', v_status);
END;
$function$;

-- 2b) PÚBLICO (anon): lê SÓ o job do token, com o mínimo para o cliente decidir. Nunca varre a tabela.
CREATE OR REPLACE FUNCTION public.fn_pm_job_aprovacao_por_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id       uuid;
  v_comp     uuid;
  v_cli      uuid;
  v_titulo   text;
  v_numero   text;
  v_descr    text;
  v_valor    numeric;
  v_prazo    date;
  v_status   text;
  v_origem   text;
  v_por      text;
  v_em       timestamptz;
  v_aj_em    timestamptz;
  v_agencia  text;
  v_cliente  text;
BEGIN
  IF p_token IS NULL OR length(btrim(p_token)) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'não encontrado');
  END IF;
  SELECT id, company_id, cliente_id, titulo, numero, descricao, valor_job, data_prazo, status,
         aprovacao_origem, aprovado_por_cliente, aprovado_em_cliente, aprovacao_ajustes_em
    INTO v_id, v_comp, v_cli, v_titulo, v_numero, v_descr, v_valor, v_prazo, v_status,
         v_origem, v_por, v_em, v_aj_em
    FROM agency_jobs WHERE aprovacao_token = p_token AND excluido_em IS NULL;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'não encontrado');
  END IF;

  SELECT coalesce(nome_fantasia, razao_social, 'Agência') INTO v_agencia FROM companies WHERE id = v_comp;
  IF v_cli IS NOT NULL THEN
    SELECT coalesce(nome_fantasia, nome) INTO v_cliente FROM agency_clientes WHERE id = v_cli;
  END IF;

  RETURN jsonb_build_object('ok', true,
    'agencia', v_agencia, 'cliente', coalesce(v_cliente, ''),
    'titulo', v_titulo, 'numero', v_numero, 'descricao', v_descr,
    'valor', v_valor, 'prazo', v_prazo, 'status', v_status,
    'origem', v_origem, 'aprovado_por', v_por, 'aprovado_em', v_em, 'ajustes_em', v_aj_em,
    'disponivel', (v_status = 'em_aprovacao'),
    'ja_aprovado', (v_status = 'publicado' AND v_origem = 'cliente'));
END;
$function$;

-- 2c) PÚBLICO (anon): o CLIENTE aprova o job pelo link → publicado, com trilha LGPD. Mesma cadeia
-- job->comissão do caminho interno (fn_pm_job_mover_status), para não quebrar a conciliação de comissão.
CREATE OR REPLACE FUNCTION public.fn_pm_job_aprovar_publico(
  p_token text, p_nome text DEFAULT NULL, p_ip text DEFAULT NULL, p_user_agent text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id    uuid;
  v_comp  uuid;
  v_status text;
  v_titulo text;
  v_valor numeric;
  v_pct   numeric;
  v_resp  uuid;
  v_now   timestamptz := now();
  v_nome  text;
  v_hash  text;
  v_comissao jsonb := NULL;
  v_com_id uuid;
  v_com_valor numeric;
BEGIN
  SELECT id, company_id, status, titulo, valor_job, percentual_comissao, responsavel_id
    INTO v_id, v_comp, v_status, v_titulo, v_valor, v_pct, v_resp
    FROM agency_jobs WHERE aprovacao_token = p_token AND excluido_em IS NULL FOR UPDATE;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'não encontrado');
  END IF;
  IF v_status = 'publicado' THEN
    RETURN jsonb_build_object('ok', true, 'ja', 'aprovado');
  END IF;
  IF v_status <> 'em_aprovacao' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'este job não está disponível para aprovação');
  END IF;

  v_nome := coalesce(nullif(btrim(p_nome), ''), 'Cliente (link)');
  v_hash := encode(extensions.digest(
    p_token || '|' || v_id::text || '|' || v_now::text || '|' || coalesce(p_ip,'') || '|' || coalesce(p_user_agent,''),
    'sha256'), 'hex');

  UPDATE agency_jobs
     SET status='publicado', aprovacao_origem='cliente',
         aprovado_por_cliente=v_nome, aprovado_em_cliente=v_now,
         aprovacao_ip=p_ip, aprovacao_user_agent=left(coalesce(p_user_agent,''),400),
         decidido_em=v_now, updated_at=v_now
   WHERE id = v_id;

  INSERT INTO public.audit_log_global
    (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES
    (v_comp, NULL, NULL, 'agency_jobs', v_id::text, 'job_aprovado_cliente',
     jsonb_build_object('status', v_status, 'titulo', v_titulo),
     jsonb_build_object('status','publicado','origem','cliente','por', v_nome,
                        'assinatura_hash', v_hash, 'user_agent', left(coalesce(p_user_agent,''),400)));

  -- cadeia job -> comissão: mesma regra do fn_pm_job_mover_status ao entrar em 'publicado'. A comissão é INSERIDA
  -- aqui (não via fn_agency_comissao_criar) porque o cliente é 'anon' e aquela função exige auth.uid()/get_user_company_ids;
  -- aqui a empresa e o vendedor vêm do PRÓPRIO job casado pelo token (sem risco de outra empresa).
  IF COALESCE(v_valor,0) > 0 AND COALESCE(v_pct,0) > 0 AND v_resp IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM agency_comissao c WHERE c.job_id = v_id AND c.deleted_em IS NULL) THEN
    v_com_valor := round(COALESCE(v_valor,0) * COALESCE(v_pct,0) / 100.0, 2);
    INSERT INTO agency_comissao (company_id, job_id, vendedor_id, base_valor, percentual, valor_comissao, competencia, status)
    VALUES (v_comp, v_id, v_resp, v_valor, v_pct, v_com_valor, date_trunc('month', now())::date, 'prevista')
    RETURNING id INTO v_com_id;
    INSERT INTO public.audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_novo)
    VALUES (v_comp, NULL, NULL, 'agency_comissao', v_com_id::text, 'comissao_criar',
            jsonb_build_object('vendedor_id', v_resp, 'job_id', v_id, 'base_valor', v_valor,
                               'percentual', v_pct, 'valor_comissao', v_com_valor, 'origem', 'aprovacao_cliente'));
    v_comissao := jsonb_build_object('ok', true, 'id', v_com_id, 'valor_comissao', v_com_valor);
  END IF;

  RETURN jsonb_build_object('ok', true, 'aprovado', true, 'assinatura_hash', v_hash, 'comissao', v_comissao);
END;
$function$;

-- 2d) PÚBLICO (anon): o CLIENTE pede ajustes → volta pra produção, registra o texto e a trilha.
CREATE OR REPLACE FUNCTION public.fn_pm_job_solicitar_ajustes_publico(
  p_token text, p_texto text DEFAULT NULL, p_nome text DEFAULT NULL, p_ip text DEFAULT NULL, p_user_agent text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id    uuid;
  v_comp  uuid;
  v_status text;
  v_titulo text;
  v_now   timestamptz := now();
  v_nome  text;
BEGIN
  SELECT id, company_id, status, titulo
    INTO v_id, v_comp, v_status, v_titulo
    FROM agency_jobs WHERE aprovacao_token = p_token AND excluido_em IS NULL FOR UPDATE;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'não encontrado');
  END IF;
  IF v_status <> 'em_aprovacao' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'este job não está disponível para solicitar ajustes');
  END IF;

  v_nome := coalesce(nullif(btrim(p_nome), ''), 'Cliente (link)');
  UPDATE agency_jobs
     SET status='em_producao', aprovacao_origem='cliente',
         aprovacao_ajustes_texto=left(coalesce(p_texto,''),2000), aprovacao_ajustes_em=v_now,
         aprovacao_ip=p_ip, aprovacao_user_agent=left(coalesce(p_user_agent,''),400),
         decidido_em=v_now, updated_at=v_now
   WHERE id = v_id;

  INSERT INTO public.audit_log_global
    (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES
    (v_comp, NULL, NULL, 'agency_jobs', v_id::text, 'job_ajustes_cliente',
     jsonb_build_object('status', v_status, 'titulo', v_titulo),
     jsonb_build_object('status','em_producao','origem','cliente','por', v_nome,
                        'ajustes', left(coalesce(p_texto,''),2000), 'user_agent', left(coalesce(p_user_agent,''),400)));

  RETURN jsonb_build_object('ok', true, 'ajustes', true);
END;
$function$;

-- 3) Grants. Interno só para authenticated; RPCs de token (guardadas) também para anon (como /p/orcamento).
REVOKE ALL ON FUNCTION public.fn_pm_job_gerar_link_aprovacao(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_pm_job_gerar_link_aprovacao(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_pm_job_aprovacao_por_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_pm_job_aprovacao_por_token(text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_pm_job_aprovar_publico(text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_pm_job_aprovar_publico(text, text, text, text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_pm_job_solicitar_ajustes_publico(text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_pm_job_solicitar_ajustes_publico(text, text, text, text, text) TO anon, authenticated, service_role;

-- 4) RD-95 "?" da ação nova na tela interna.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES (
  'pm.aprovacao.link_cliente',
  '/dashboard/pm/aprovacao',
  'Aprovação do cliente',
  'Link de aprovação do cliente',
  'Nada a preencher: é a ação de gerar um link para o CLIENTE aprovar este job pelo celular, sem precisar de login.',
  'Gera um link seguro (uma chave por job) que você envia ao cliente. No link, o cliente vê o job e aprova ou pede ajustes; a aprovação fica registrada como "aprovado pelo cliente" com data, origem e trilha (LGPD). Aprovar publica o job e gera a comissão, igual ao OK interno. Diferente do botão "Registrar OK recebido por fora", que é para quando o cliente já respondeu por telefone/e-mail e você só registra.',
  'Cliente da obra aprova a arte pelo WhatsApp: copie o link, mande por mensagem; quando ele toca em Aprovar, o job publica sozinho e aparece aqui como aprovado pelo cliente.',
  'O link só vale enquanto o job está "em aprovação". Se o cliente já aprovou, o link mostra que está aprovado e não aprova de novo. Nunca compartilhe o link em local público: quem tem o link aprova o job.',
  'pm_comercial',
  540,
  1,
  'publicado'
)
ON CONFLICT (chave) DO NOTHING;

COMMIT;
