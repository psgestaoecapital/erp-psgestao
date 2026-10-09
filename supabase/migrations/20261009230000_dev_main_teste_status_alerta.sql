-- Proteção da esteira (CEO 09/10) — aditiva, não recria função de núcleo.
-- (4a) Fonte do dado do card "Esteira" da aba Codes: resultado da Aceitação @pos-migration da main
--      (verde/vermelho, DESDE quando, qual spec falhou). Escrito pelo workflow aceitacao-pos-migration.yml.
-- (4b) pg_cron a cada 10 min: @pos-migration da main VERMELHO há mais de 30 min → alerta ao CEO em 3 canais:
--      (1) briefing  → insere em erp_truth_alerts (fn_briefing_sessao já expõe severity high/critical em
--          alertas_pendentes_para_ceo); (2) sino do ERP → erp_notificacao_usuario; (3) e-mail → fn_enviar_email.
--      Um alerta por episódio (erp_dev_main_teste.alertado_em); ao ficar verde, o alerta é resolvido e zerado.

-- ── (4a) Tabela de status (uma linha) ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_dev_main_teste (
  id            smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  verde         boolean,
  desde         timestamptz NOT NULL DEFAULT now(),   -- desde quando está nesse estado (muda só quando verde vira T/F)
  spec_falha    text,                                 -- spec que falhou (quando vermelho)
  run_id        bigint,
  run_url       text,
  head_sha      text,
  alertado_em   timestamptz,                          -- (4b) quando o alerta de >30 min já foi enviado neste episódio
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_dev_main_teste ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dev_main_teste_sel ON public.erp_dev_main_teste;
CREATE POLICY dev_main_teste_sel ON public.erp_dev_main_teste FOR SELECT TO authenticated
  USING (public.fn_dev_painel_pode_ver());            -- mesma guarda das demais tabelas da aba Codes
REVOKE ALL ON public.erp_dev_main_teste FROM PUBLIC, anon;
GRANT SELECT ON public.erp_dev_main_teste TO authenticated;

-- ── (4a) Writer: só o workflow (service_role) grava; o `desde` só muda quando o estado vira ────────────────────────
CREATE OR REPLACE FUNCTION public.fn_dev_main_teste_set(
  p_verde boolean, p_spec text DEFAULT NULL, p_run_id bigint DEFAULT NULL,
  p_run_url text DEFAULT NULL, p_head_sha text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
-- ci-sem-guarda: writer de status de CI, só service_role (REVOKE abaixo)
BEGIN
  INSERT INTO erp_dev_main_teste AS m (id, verde, desde, spec_falha, run_id, run_url, head_sha, alertado_em, atualizado_em)
  VALUES (1, p_verde, now(), p_spec, p_run_id, p_run_url, p_head_sha, NULL, now())
  ON CONFLICT (id) DO UPDATE SET
    verde         = EXCLUDED.verde,
    desde         = CASE WHEN m.verde IS DISTINCT FROM EXCLUDED.verde THEN now() ELSE m.desde END,
    spec_falha    = EXCLUDED.spec_falha,
    run_id        = EXCLUDED.run_id,
    run_url       = EXCLUDED.run_url,
    head_sha      = EXCLUDED.head_sha,
    alertado_em   = CASE WHEN EXCLUDED.verde THEN NULL ELSE m.alertado_em END,  -- ficou verde → pronto p/ novo episódio
    atualizado_em = now();
  -- ficou verde → resolve o alerta do briefing, se houver
  IF p_verde THEN
    UPDATE erp_truth_alerts
       SET status = 'resolvido', resolvido_em = now(), updated_at = now(),
           notas_resolucao = COALESCE(notas_resolucao, 'main @pos-migration voltou a verde')
     WHERE rule_id = 'dev_main_pos_migration_vermelha' AND status = 'novo';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_dev_main_teste_set(boolean,text,bigint,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_dev_main_teste_set(boolean,text,bigint,text,text) TO service_role;

-- ── (4b) Alerta: @pos-migration da main vermelho há > 30 min e ainda não avisado neste episódio ────────────────────
CREATE OR REPLACE FUNCTION public.fn_dev_main_teste_alerta()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
-- ci-sem-guarda: rotina de alerta interno (pg_cron), sem GRANT a usuário
DECLARE
  m        RECORD;
  v_ceo    uuid := '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb';  -- conta CEO (gilberto.paravizi@gmail.com)
  v_email  text;
  v_comp   uuid;
  v_min    int;
  v_msg    text;
BEGIN
  SELECT * INTO m FROM erp_dev_main_teste WHERE id = 1;
  IF m.id IS NULL OR m.verde IS NOT FALSE THEN RETURN; END IF;         -- sem dado ou verde → nada a fazer
  IF m.alertado_em IS NOT NULL THEN RETURN; END IF;                    -- já avisado neste episódio vermelho
  IF now() - m.desde < interval '30 minutes' THEN RETURN; END IF;      -- ainda dentro dos 30 min de tolerância

  v_min := floor(extract(epoch FROM (now() - m.desde)) / 60);
  v_msg := 'A Aceitação @pos-migration da main está VERMELHA há ' || v_min || ' min'
        || COALESCE(' — spec: ' || m.spec_falha, '') || '. Regra do CEO: corrigir em 1 h ou reverter a PR culpada.';

  -- (1) briefing do CEO: erp_truth_alerts (fn_briefing_sessao expõe high/critical em alertas_pendentes_para_ceo)
  INSERT INTO erp_truth_alerts (rule_id, severity, area, tipo_divergencia, mensagem, recomendacao, status)
  VALUES ('dev_main_pos_migration_vermelha', 'high', 'dev', 'ci_main_vermelha', v_msg,
          COALESCE('Run: ' || m.run_url, 'Abrir GitHub Actions'), 'novo');

  -- (2) sino do ERP para o CEO
  SELECT email INTO v_email FROM users WHERE id = v_ceo;
  SELECT company_id INTO v_comp FROM user_companies WHERE user_id = v_ceo LIMIT 1;
  IF v_comp IS NOT NULL THEN
    INSERT INTO erp_notificacao_usuario (company_id, destinatario_id, tipo, titulo, mensagem, link, origem_tipo)
    VALUES (v_comp, v_ceo, 'alerta_ci', 'Teste da main vermelho há ' || v_min || ' min', v_msg,
            m.run_url, 'dev_main_teste');
  END IF;

  -- (3) e-mail para o CEO (template genérico orientado por p_dados; idempotente por episódio)
  IF v_email IS NOT NULL THEN
    PERFORM fn_enviar_email(v_email, 'contrato_evento', jsonb_build_object(
      'assunto',      'Teste da main vermelho ha ' || v_min || ' min - PS Gestao',
      'titulo_email', 'Aceitacao @pos-migration da main vermelha',
      'corpo',        v_msg,
      'cta',          'Abrir o run no GitHub Actions',
      'link',         COALESCE(m.run_url, 'https://github.com/psgestaoecapital/erp-psgestao/actions'),
      'idempotency_key', 'main-vermelha-' || to_char(m.desde, 'YYYYMMDDHH24MISS')));
  END IF;

  UPDATE erp_dev_main_teste SET alertado_em = now() WHERE id = 1;
END $$;
REVOKE ALL ON FUNCTION public.fn_dev_main_teste_alerta() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_dev_main_teste_alerta() TO service_role;

-- pg_cron a cada 10 min (idempotente: recria o agendamento se já existir)
SELECT cron.unschedule('dev-main-vermelha-alerta')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dev-main-vermelha-alerta');
SELECT cron.schedule('dev-main-vermelha-alerta', '*/10 * * * *', $cron$SELECT public.fn_dev_main_teste_alerta()$cron$);
