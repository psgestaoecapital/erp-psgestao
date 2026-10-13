-- Proteger o LEMBRETE de queimar em branco enquanto o provedor de e-mail não existe (SPEC do CEO 05/09).
-- Contexto: RESEND_API_KEY/EMAIL_FROM ainda ausentes no Vault → fn_enviar_email devolve 'sem_provedor'.
-- A v1 (migration 20260905120000) marcava lembrete_enviado_em ANTES de enviar (proteção correta contra
-- lembrete repetido, MAS destrutiva sem provedor): o cron das 08h BRT marcaria #14/#16 como avisados
-- sem que nenhum e-mail existisse, e sem segunda chance.
-- Regra da SPEC: só queima a marca quando o envio DEU CERTO, ou quando o e-mail é inválido (não adianta
-- tentar de novo), ou numa falha REAL do provedor (não insiste todo dia + alarma). 'sem_provedor' deixa
-- o lembrete DISPONÍVEL para o dia seguinte — quando o Resend estiver no ar, ele sai de verdade.
CREATE OR REPLACE FUNCTION public.fn_sugestao_lembrete_confirmacao()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rec record; v_mail jsonb; v_enviados int := 0; v_falhas int := 0; v_adiados int := 0;
BEGIN
  FOR v_rec IN
    SELECT DISTINCT ON (s.id)
           s.id AS sugestao_id, s.numero, s.titulo, s.resposta, s.user_email, s.user_name, s.company_id,
           n.id AS notif_id
      FROM sugestoes s
      JOIN sugestao_notificacao n ON n.sugestao_id = s.id AND n.tipo = 'resposta'
     WHERE s.resposta_aprovada = true
       AND COALESCE(s.confirmado_pelo_autor, false) = false
       AND s.resposta_aprovada_em <= now() - interval '2 days'
       AND n.lembrete_enviado_em IS NULL
     ORDER BY s.id, n.criado_em DESC
  LOOP
    -- e-mail inválido: queima a marca (não adianta tentar de novo amanhã)
    IF v_rec.user_email IS NULL OR position('@' in v_rec.user_email) = 0 THEN
      UPDATE sugestao_notificacao SET lembrete_enviado_em = now() WHERE id = v_rec.notif_id;
      CONTINUE;
    END IF;
    BEGIN
      v_mail := public.fn_enviar_email(v_rec.user_email, 'chamado_lembrete', jsonb_build_object(
        'nome', v_rec.user_name, 'numero', v_rec.numero, 'titulo_chamado', v_rec.titulo, 'resposta', v_rec.resposta,
        'link', public.fn_app_base_url() || '/dashboard/melhorias?n=' || v_rec.numero,
        'idempotency_key', 'chamado-lembrete-' || v_rec.sugestao_id::text, 'company_id', v_rec.company_id));
      IF COALESCE((v_mail->>'ok')::boolean, false) THEN
        -- só marca DEPOIS de sair: garante "uma vez só" sem perder o lembrete
        UPDATE sugestao_notificacao SET lembrete_enviado_em = now() WHERE id = v_rec.notif_id;
        v_enviados := v_enviados + 1;
      ELSIF COALESCE(v_mail->>'erro','') ILIKE '%não configurado%' THEN
        -- provedor ausente: NÃO queima a marca. Tenta de novo amanhã, quando o Resend estiver no ar.
        v_adiados := v_adiados + 1;
      ELSE
        -- falha real do provedor: queima (não insiste todo dia) e alarma
        UPDATE sugestao_notificacao SET lembrete_enviado_em = now() WHERE id = v_rec.notif_id;
        v_falhas := v_falhas + 1;
        PERFORM fn_ia_falha_registrar('pg','fn_sugestao_lembrete_confirmacao','email_lembrete_confirmacao','email:resend',
                NULL, COALESCE(v_mail->>'erro','falha_email'), v_rec.company_id);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE sugestao_notificacao SET lembrete_enviado_em = now() WHERE id = v_rec.notif_id;
      v_falhas := v_falhas + 1;
      PERFORM fn_ia_falha_registrar('pg','fn_sugestao_lembrete_confirmacao','email_lembrete_confirmacao','email:resend',
              NULL, SQLERRM, v_rec.company_id);
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'lembretes_enviados', v_enviados, 'adiados_sem_provedor', v_adiados, 'falhas', v_falhas);
END $function$;
