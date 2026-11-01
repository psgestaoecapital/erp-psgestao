-- #2936 etapa 5 · Lembretes automáticos de assinatura eletrônica de contrato (Proplay, carteira Jordana).
-- Uma vez por dia (09:00 BRT), quem ainda não assinou recebe por e-mail um lembrete com o link de assinatura.
-- Regras:
--  - envio aguardando e vencido vira 'expirado' (antes só virava quando alguém abria o link);
--  - lembrete só para signatário pendente/visualizado, com e-mail, de envio aguardando que ainda vale por 12 h ou mais;
--  - o 1º lembrete sai 2 dias depois do envio, os seguintes 2 dias depois do anterior, no máximo 3;
--  - quem está assinando agora (código de confirmação válido ou link aberto há menos de 1 h) não recebe;
--  - o token do link nunca é guardado (o banco só tem o hash), então o lembrete leva um LINK NOVO e o anterior deixa de
--    valer. A troca do token e o e-mail andam juntos: se o e-mail não sair, a troca é desfeita (o link antigo segue valendo).
-- Função só para o cron/service_role (REVOKE de anon/public/authenticated). Sem UPDATE em dado de cliente além das
-- próprias tabelas da assinatura.

ALTER TABLE public.erp_contrato_assinatura_signatario
  ADD COLUMN IF NOT EXISTS lembretes_enviados smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultimo_lembrete_em timestamptz;
GRANT SELECT (lembretes_enviados, ultimo_lembrete_em) ON public.erp_contrato_assinatura_signatario TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_contrato_assin__html(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT replace(replace(replace(replace(COALESCE(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;
REVOKE EXECUTE ON FUNCTION public.fn_contrato_assin__html(text) FROM anon, public, authenticated;

-- Rotina do cron (sem usuário logado): o acesso é só pelo pg_cron/service_role.
-- ci-sem-guarda: fn_contrato_assinatura_lembretes — só cron/service_role; percorre os envios aguardando de todas as empresas (sem usuário logado)
CREATE OR REPLACE FUNCTION public.fn_contrato_assinatura_lembretes(p_limite int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
DECLARE
  v_r record; v_token text; v_mail jsonb; v_link text; v_n int;
  v_expirados int := 0; v_enviados int := 0; v_adiados int := 0; v_falhas int := 0;
BEGIN
  WITH x AS (
    UPDATE public.erp_contrato_assinatura_envio SET status = 'expirado'
     WHERE status = 'aguardando' AND expira_em < now()
    RETURNING id, contrato_id, company_id, versao
  ), ev AS (
    INSERT INTO public.erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata)
    SELECT contrato_id, company_id, 'assinatura_expirada',
           'Prazo da assinatura eletrônica venceu sem todas as assinaturas (versão ' || versao || ')',
           jsonb_build_object('envio_id', id, 'versao', versao)
      FROM x
    RETURNING 1
  )
  SELECT count(*) INTO v_expirados FROM ev;

  FOR v_r IN
    SELECT s.id, s.nome, s.email, s.company_id, s.lembretes_enviados, e.id AS envio_id, e.contrato_id, e.versao, e.expira_em,
           c.nome AS contrato_nome, c.numero AS contrato_numero, COALESCE(co.nome_fantasia, co.razao_social) AS empresa
      FROM public.erp_contrato_assinatura_signatario s
      JOIN public.erp_contrato_assinatura_envio e ON e.id = s.envio_id
      JOIN public.erp_contratos c ON c.id = e.contrato_id
      LEFT JOIN public.companies co ON co.id = e.company_id
     WHERE e.status = 'aguardando'
       AND e.expira_em >= now() + interval '12 hours'
       AND s.status IN ('pendente', 'visualizado')
       AND s.email IS NOT NULL AND position('@' in s.email) > 1
       AND s.lembretes_enviados < 3
       AND COALESCE(s.ultimo_lembrete_em, e.criado_em) <= now() - interval '2 days'
       AND (s.codigo_expira_em IS NULL OR s.codigo_expira_em < now())
       AND (s.visualizado_em IS NULL OR s.visualizado_em < now() - interval '1 hour')
     ORDER BY e.criado_em, s.ordem
     LIMIT GREATEST(1, LEAST(COALESCE(p_limite, 50), 200))
  LOOP
    v_n := v_r.lembretes_enviados + 1;
    BEGIN
      v_token := encode(extensions.gen_random_bytes(24), 'hex');
      UPDATE public.erp_contrato_assinatura_signatario
         SET token_hash = public.fn_contrato_assin__sha256(v_token), lembretes_enviados = v_n, ultimo_lembrete_em = now()
       WHERE id = v_r.id AND status IN ('pendente', 'visualizado');
      v_link := public.fn_app_base_url() || '/sign/contrato/' || v_token;
      v_mail := public.fn_enviar_email(v_r.email, 'contrato_evento', jsonb_build_object(
        'assunto', 'Lembrete: contrato para assinar' || COALESCE(' · ' || v_r.empresa, ''),
        'titulo_email', 'Seu contrato ainda está esperando a assinatura',
        'corpo', 'Olá, ' || public.fn_contrato_assin__html(split_part(v_r.nome, ' ', 1)) || '. '
                 || CASE WHEN v_r.empresa IS NOT NULL THEN public.fn_contrato_assin__html(v_r.empresa) || ' aguarda' ELSE 'Aguardamos' END
                 || ' a sua assinatura no contrato <b>'
                 || public.fn_contrato_assin__html(COALESCE(v_r.contrato_nome, v_r.contrato_numero, 'contrato')) || '</b>. '
                 || 'Toque no botão, confira o documento e confirme com o código que enviaremos para este e-mail. '
                 || 'O link vale até ' || to_char(v_r.expira_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') || '. '
                 || 'Use o link deste e-mail: por segurança, o link enviado antes deixou de valer.',
        'cta', 'Ver e assinar', 'link', v_link,
        'idempotency_key', 'contrato-assin-lembrete-' || v_r.id::text || '-' || v_n, 'company_id', v_r.company_id));
      IF NOT COALESCE((v_mail->>'ok')::boolean, false) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'lembrete_nao_enviado', DETAIL = COALESCE(v_mail->>'erro', 'falha_email');
      END IF;
      INSERT INTO public.erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata)
      VALUES (v_r.contrato_id, v_r.company_id, 'assinatura_lembrete',
              'Lembrete ' || v_n || ' de 3 enviado por e-mail a ' || v_r.nome || ' (link renovado)',
              jsonb_build_object('envio_id', v_r.envio_id, 'versao', v_r.versao, 'signatario_id', v_r.id, 'lembrete', v_n));
      v_enviados := v_enviados + 1;
    EXCEPTION WHEN OTHERS THEN
      -- a troca do token foi desfeita junto (o link antigo segue valendo)
      IF SQLERRM = 'lembrete_nao_enviado' AND COALESCE(v_mail->>'erro', '') ILIKE '%não configurado%' THEN
        v_adiados := v_adiados + 1;   -- sem provedor: tenta de novo amanhã
      ELSE
        -- falha real: espera o próximo intervalo de 2 dias (não insiste todo dia) e alarma
        UPDATE public.erp_contrato_assinatura_signatario SET ultimo_lembrete_em = now() WHERE id = v_r.id;
        v_falhas := v_falhas + 1;
        PERFORM public.fn_ia_falha_registrar('pg', 'fn_contrato_assinatura_lembretes', 'email_lembrete_assinatura', 'email:resend',
                NULL, COALESCE(v_mail->>'erro', SQLERRM), v_r.company_id);
      END IF;
    END;
    v_mail := NULL;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'expirados', v_expirados, 'lembretes_enviados', v_enviados,
                            'adiados_sem_provedor', v_adiados, 'falhas', v_falhas);
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_contrato_assinatura_lembretes(int) FROM anon, public, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_contrato_assinatura_lembretes(int) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'contrato-assinatura-lembretes') THEN
    PERFORM cron.unschedule('contrato-assinatura-lembretes');
  END IF;
END $$;
SELECT cron.schedule('contrato-assinatura-lembretes', '0 12 * * *', $cron$ SELECT public.fn_contrato_assinatura_lembretes(50); $cron$);
