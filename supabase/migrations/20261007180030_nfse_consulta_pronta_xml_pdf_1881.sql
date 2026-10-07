-- Chamado #1881 — NFS-e autorizada: XML em minutos + PDF assim que a prefeitura gerar.
--
-- DIAGNÓSTICO (provado no dado de produção — RD-38):
--   * Os webhooks da Focus NÃO chegam para a maioria das empresas: só a R.R tem webhook_secret
--     gravado e, em 30 dias, o erp_fiscal_webhook_log registrou UMA única entrega. Sem webhook, a
--     nota só é atualizada pelo cron de 15 min → a autorização aparece com 5 a 65 min de atraso.
--   * O cron só reconsultava `status='processando' OR (status='autorizada' AND xml_url IS NULL)`.
--     Quando o XML já veio mas o PDF ainda não (a prefeitura gera o DANFSE depois), a nota ficava
--     AUTORIZADA + xml_url preenchido + pdf_url NULL e NUNCA mais era reconsultada → PDF nunca baixava
--     (ex. real: NFS-e nº 61 da R.R, autorizada, com XML e sem PDF).
--   * fn_webhook_atualizar_nfse só gravava quando o STATUS (ou o motivo) mudava; um 2º webhook trazendo
--     o PDF depois da autorização era descartado (status já era 'autorizada').
--
-- O QUE ESTA MIGRATION FAZ (código; a correção definitiva da promessa "em minutos" sem depender de
-- webhook):
--   A) fn_nfse_auto_consultar_pendentes passa a reconsultar também AUTORIZADA sem PDF (janela de 48 h —
--      limite para não martelar indefinidamente município que não emite DANFSE) e AUTORIZADA sem XML.
--   B) O cron sobe de 15 min → 5 min (rede de segurança: XML em minutos mesmo sem webhook; o PDF entra
--      no próximo ciclo assim que a prefeitura o gerar).
--   C) fn_webhook_atualizar_nfse passa a gravar XML/PDF/número/código de verificação que cheguem depois,
--      mesmo com o status inalterado (idempotente: COALESCE preserva o que já existe; só preenche vazio).
--
-- SENSÍVEL (fiscal · CREATE OR REPLACE de funções existentes) → PR com etiqueta revisao-eng-chefe.
-- Caminho INSTANTÂNEO (fora do código, operacional): registrar o webhook da Focus por empresa em
-- Configurações › Fiscal (POST /api/fiscal/webhook-config) — hoje só a R.R está registrada.
--
-- Segurança (incidente 03/10): nada varre tabela grande nem chama função por linha; o cron continua com
-- LIMIT 50, janela de 7 dias e net.http_post fire-and-forget.

-- A/B) Cron: critério ampliado (XML e PDF faltantes) + cadência 15 → 5 min.
CREATE OR REPLACE FUNCTION public.fn_nfse_auto_consultar_pendentes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_service_role text;
  v_url_base text := 'https://horsymhsinqcimflrtjo.supabase.co';
  v_rec record;
  v_request_id bigint;
  v_qtd int := 0;
  v_request_ids bigint[] := ARRAY[]::bigint[];
BEGIN
  SELECT decrypted_secret INTO v_service_role
  FROM vault.decrypted_secrets
  WHERE name = 'SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER';

  IF v_service_role IS NULL THEN
    RAISE WARNING 'fn_nfse_auto_consultar_pendentes: vault secret SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER ausente';
    RETURN jsonb_build_object('ok', false, 'erro', 'service_role ausente no vault');
  END IF;

  -- #1881 · critério ampliado: processando, OU autorizada sem XML (rede de segurança), OU autorizada
  -- sem PDF nas últimas 48 h (o DANFSE costuma sair minutos depois do XML — reconsulta até cair).
  FOR v_rec IN
    SELECT id
    FROM erp_nfse_emitidas
    WHERE provider = 'focusnfe'
      AND provider_reference IS NOT NULL
      AND criado_em >= now() - interval '7 days'
      AND (
        status = 'processando'
        OR (status = 'autorizada' AND (xml_url IS NULL OR btrim(xml_url) = ''))
        OR (status = 'autorizada'
            AND (pdf_url IS NULL OR btrim(pdf_url) = '')
            AND criado_em >= now() - interval '48 hours')
      )
    ORDER BY criado_em
    LIMIT 50
  LOOP
    SELECT net.http_post(
      url := v_url_base || '/functions/v1/gov-nfse-consultar',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_role
      ),
      body := jsonb_build_object('record_id', v_rec.id),
      timeout_milliseconds := 15000
    ) INTO v_request_id;

    v_request_ids := array_append(v_request_ids, v_request_id);
    v_qtd := v_qtd + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'qtd_disparada', v_qtd,
    'request_ids', to_jsonb(v_request_ids),
    'ts', now()
  );
END;
$function$;

COMMENT ON FUNCTION public.fn_nfse_auto_consultar_pendentes IS
  '#1881 · dispara consulta Focus em NFS-e processando, autorizada-sem-XML (7d) e autorizada-sem-PDF (48h). Cap 50.';

REVOKE ALL ON FUNCTION public.fn_nfse_auto_consultar_pendentes() FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_nfse_auto_consultar_pendentes() TO service_role;

-- Cadência 15 → 5 min (idempotente: desagenda antes se já existir).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nfse-auto-consultar-pendentes') THEN
    PERFORM cron.unschedule('nfse-auto-consultar-pendentes');
  END IF;
END $$;

SELECT cron.schedule(
  'nfse-auto-consultar-pendentes',
  '*/5 * * * *',
  $cron$ SELECT public.fn_nfse_auto_consultar_pendentes(); $cron$
);

-- C) Webhook: grava XML/PDF/número/código que cheguem DEPOIS, mesmo com o status já 'autorizada'.
CREATE OR REPLACE FUNCTION public.fn_webhook_atualizar_nfse(
  p_provider_reference text,
  p_status text,
  p_motivo_rejeicao text DEFAULT NULL::text,
  p_numero text DEFAULT NULL::text,
  p_codigo_verificacao text DEFAULT NULL::text,
  p_xml_url text DEFAULT NULL::text,
  p_pdf_url text DEFAULT NULL::text,
  p_provider_raw jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nfse erp_nfse_emitidas%ROWTYPE;
  v_status_normalizado text;
BEGIN
  -- Normaliza status Focus NFe → status interno PS
  -- Focus: autorizado | processando_autorizacao | erro_autorizacao | cancelado
  -- Interno: autorizada | processando | erro | cancelada
  v_status_normalizado := CASE LOWER(p_status)
    WHEN 'autorizado' THEN 'autorizada'
    WHEN 'processando_autorizacao' THEN 'processando'
    WHEN 'erro_autorizacao' THEN 'erro'
    WHEN 'cancelado' THEN 'cancelada'
    ELSE p_status
  END;

  -- Busca a NFSe pelo provider_reference (id Focus NFe)
  SELECT * INTO v_nfse
  FROM erp_nfse_emitidas
  WHERE provider_reference = p_provider_reference
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'erro', 'NFSe não encontrada',
      'provider_reference', p_provider_reference
    );
  END IF;

  -- Atualiza quando há mudança real OU quando chega um dado que ainda falta (XML/PDF/número/código).
  -- #1881: antes só gravava se o status/motivo mudasse — um 2º webhook trazendo o PDF depois da
  -- autorização era descartado. Idempotente: o COALESCE abaixo preserva o que já existe; só preenche
  -- o que está vazio.
  UPDATE erp_nfse_emitidas
  SET
    status = v_status_normalizado,
    motivo_rejeicao = COALESCE(p_motivo_rejeicao, motivo_rejeicao),
    numero = COALESCE(p_numero, numero),
    codigo_verificacao = COALESCE(p_codigo_verificacao, codigo_verificacao),
    xml_url = COALESCE(p_xml_url, xml_url),
    pdf_url = COALESCE(p_pdf_url, pdf_url),
    provider_raw = provider_raw || p_provider_raw,
    atualizado_em = NOW()
  WHERE id = v_nfse.id
    AND (
      status IS DISTINCT FROM v_status_normalizado
      OR motivo_rejeicao IS DISTINCT FROM p_motivo_rejeicao
      OR (p_xml_url IS NOT NULL AND btrim(p_xml_url) <> '' AND (xml_url IS NULL OR btrim(xml_url) = ''))
      OR (p_pdf_url IS NOT NULL AND btrim(p_pdf_url) <> '' AND (pdf_url IS NULL OR btrim(pdf_url) = ''))
      OR (p_numero IS NOT NULL AND btrim(p_numero) <> '' AND (numero IS NULL OR btrim(numero) = ''))
      OR (p_codigo_verificacao IS NOT NULL AND btrim(p_codigo_verificacao) <> '' AND (codigo_verificacao IS NULL OR btrim(codigo_verificacao) = ''))
    );

  RETURN jsonb_build_object(
    'ok', true,
    'nfse_id', v_nfse.id,
    'company_id', v_nfse.company_id,
    'status_anterior', v_nfse.status,
    'status_novo', v_status_normalizado,
    'mudou', v_nfse.status IS DISTINCT FROM v_status_normalizado
  );
END;
$function$;

-- Guardas da função (check:fn-guards) — preservam exatamente o acesso vivo em produção (só service_role executa).
-- ci-sem-guarda: fn_webhook_atualizar_nfse — webhook da Focus NFe (conexão service_role, sem usuário/empresa logada); o alvo é a ÚNICA nota do provider_reference recebido, autenticada no edge focus-nfe-webhook pelo token do webhook da empresa. Não há empresa de usuário a conferir.
REVOKE ALL ON FUNCTION public.fn_webhook_atualizar_nfse(text, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_webhook_atualizar_nfse(text, text, text, text, text, text, text, jsonb) TO service_role;
