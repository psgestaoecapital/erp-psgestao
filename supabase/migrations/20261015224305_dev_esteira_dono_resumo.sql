-- Aba Codes · cartão do gilberto-esteira (Eng. Chefe 15/10): números do DONO DA ESTEIRA, só leitura.
-- Função nova (aditiva), guarda fn_dev_painel_pode_ver, REVOKE anon. Sem tabela nova, sem dado de cliente.
CREATE OR REPLACE FUNCTION public.fn_dev_esteira_dono_resumo()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ult_pub timestamptz;
  v_ac_hoje int;
  v_destrav int;
  v_nota jsonb;
BEGIN
  IF NOT public.fn_dev_painel_pode_ver() THEN RAISE EXCEPTION 'sem permissão'; END IF;
  SELECT max(ocorrido_em) INTO v_ult_pub FROM erp_dev_entrega
   WHERE evento = 'publicada' AND ocorrido_em > now() - interval '7 days';

  WITH ac AS (
    SELECT (h->>'em')::timestamptz AS em
      FROM erp_agente_mensagem m, jsonb_array_elements(m.acionamento_historico) h
     WHERE m.para = 'gilberto-esteira' AND m.atualizado_em > now() - interval '2 days'
  )
  SELECT count(*) FILTER (WHERE em >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'),
         0
    INTO v_ac_hoje, v_destrav FROM ac;

  -- publicação "destravada por ele" = publicada até 60 min depois de um acordar dele (janela de 24 h)
  SELECT count(DISTINCT e.pr_numero) INTO v_destrav
    FROM erp_dev_entrega e
   WHERE e.evento = 'publicada' AND e.ocorrido_em > now() - interval '24 hours'
     AND EXISTS (
       SELECT 1 FROM erp_agente_mensagem m, jsonb_array_elements(m.acionamento_historico) h
        WHERE m.para = 'gilberto-esteira' AND m.atualizado_em > now() - interval '2 days'
          AND (h->>'em')::timestamptz BETWEEN e.ocorrido_em - interval '60 minutes' AND e.ocorrido_em);

  SELECT jsonb_build_object('em', m.atualizado_em, 'texto', left(coalesce(nullif(m.resposta, ''), m.corpo), 280))
    INTO v_nota
    FROM erp_agente_mensagem m
   WHERE m.de = 'gilberto-esteira'
   ORDER BY m.atualizado_em DESC LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'min_sem_publicar', CASE WHEN v_ult_pub IS NULL THEN NULL ELSE round(EXTRACT(EPOCH FROM (now() - v_ult_pub)) / 60)::int END,
    'acordado_hoje', coalesce(v_ac_hoje, 0),
    'publicacoes_destravadas_24h', coalesce(v_destrav, 0),
    'ultima_anotacao', v_nota);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_dev_esteira_dono_resumo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dev_esteira_dono_resumo() TO authenticated, service_role;
