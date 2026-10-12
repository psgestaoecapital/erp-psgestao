-- Formaliza no repo o fix do Monitor aplicado direto no banco em emergência (12/10, msg fab58bec).
-- (1) v_dp só conta nudge "AUTO: drenagem%" dos últimos 20 min (evita deadlock com Code morto);
-- (2) severity high->critical / medium->warn (CHECK de erp_truth_alerts) e regras cadastradas em truth_audit_rules (FK);
-- (3) REVOKE de anon na função SECURITY DEFINER (gate check:fn-guards).
-- Fonte de verdade: definição VIVA em produção (pg_get_functiondef). Idempotente.

INSERT INTO public.truth_audit_rules (id, area, nome, ativo, descricao, check_type, frequencia, observacao, severity_when_violated)
VALUES
 ('esteira_parada_30','sistema','Esteira parada 30min',true,'Esteira de merge sem publicar ha >=30min com gate verde e PRs prontas (emergencia).','temporal','on_demand','Disparada por fn_monitor_merge_tick','critical'),
 ('esteira_parada_45','sistema','Esteira parada 45min',true,'Esteira sem publicar ha >=45min — escala ao CEO (notificacao + email).','temporal','on_demand','Disparada por fn_monitor_merge_tick','critical'),
 ('esteira_gargalo_revisor','sistema','Gargalo no revisor',true,'PRs revisadas esperando aval do revisor — gargalo e o revisor, nao a drenagem.','temporal','on_demand','Disparada por fn_monitor_merge_tick','warn')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_monitor_merge_tick()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_red boolean; v_pending int; c record; v_msg uuid;
  v_esp int; v_min numeric; v_dp int; v_cancel int; v_motivo text; v_cooldown int;
  v_rev int; v_gargalo text; v_ult timestamptz; v_ep text; v_txt text;
  v_ceo uuid := '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb'; v_email text; v_comp uuid;
BEGIN
  SELECT (NOT verde) INTO v_red FROM erp_dev_main_teste WHERE id=1;

  IF COALESCE(v_red,false) THEN
    SELECT count(*) INTO v_pending FROM erp_agente_mensagem WHERE para='gilberto-desenv' AND assunto LIKE 'AUTO: portao%' AND status IN ('recebida','em_andamento') AND NOT arquivada;
    IF v_pending=0 THEN
      BEGIN INSERT INTO erp_agente_mensagem (para,de,tipo,assunto,corpo,requer_ok_ceo,enviado_por)
        VALUES ('gilberto-desenv','eng_chefe','tarefa','AUTO: portao VERMELHO - verifique','Portao VERMELHO. Conserte; apos dispare @pos novo. Nunca esconda bug.',false,'eng_chefe');
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END IF;

  IF NOT COALESCE(v_red,false) THEN
    SELECT count(*) INTO v_esp FROM erp_esteira_pr_estado WHERE estado='esperando';
    SELECT count(*) INTO v_cancel FROM erp_esteira_pr_estado WHERE estado='esperando' AND motivo ILIKE '%cancelad%';
    SELECT count(*) INTO v_rev FROM erp_esteira_pr_estado
      WHERE estado='esperando' AND via='revisada' AND (motivo ILIKE '%autoriz%' OR motivo ILIKE '%revis%' OR motivo ILIKE '%aval%');
    SELECT max(ocorrido_em) INTO v_ult FROM erp_dev_entrega WHERE evento='publicada';
    v_min := EXTRACT(EPOCH FROM (now()-v_ult))/60;
    v_gargalo := CASE WHEN v_rev > 0 AND v_rev >= v_esp - v_rev THEN 'revisor' ELSE 'drenagem' END;
    v_ep := to_char(v_ult,'YYYYMMDDHH24MISS');

    SELECT count(*) INTO v_dp FROM erp_agente_mensagem WHERE para='gilberto-desenv' AND assunto LIKE 'AUTO: drenagem%' AND status IN ('recebida','em_andamento') AND NOT arquivada AND criado_em > now()-interval '20 minutes';
    SELECT count(*) INTO v_cooldown FROM erp_agente_mensagem WHERE para='gilberto-desenv' AND assunto LIKE 'AUTO: drenagem%' AND criado_em > now()-interval '8 minutes';
    IF v_esp > 0 AND (v_cancel > 0 OR v_min > 15) THEN
      v_motivo := CASE WHEN v_cancel>0 THEN 'CHECK CANCELADO em '||v_cancel||' PR(s)' ELSE 'nada publicado ha '||round(v_min)||'min' END;
      IF v_gargalo = 'drenagem' AND v_dp=0 AND v_cooldown=0 THEN
        BEGIN INSERT INTO erp_agente_mensagem (para,de,tipo,assunto,corpo,requer_ok_ceo,enviado_por)
          VALUES ('gilberto-desenv','eng_chefe','tarefa','AUTO: drenagem - destravar',
            format('Gate VERDE, %s PRs prontas, sinal de travamento: %s. Gargalo: drenagem. Confira se e stall REAL (check cancelado/nao roda / concorrencia) ou so cadencia normal — se real, destrave o proximo PR. Nunca esconda bug.', v_esp, v_motivo),false,'eng_chefe');
        EXCEPTION WHEN OTHERS THEN NULL; END;
      ELSIF v_gargalo = 'revisor' THEN
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM erp_truth_alerts WHERE rule_id='esteira_gargalo_revisor' AND evidencia->>'episodio'=v_ep) THEN
            INSERT INTO erp_truth_alerts (rule_id, severity, area, tipo_divergencia, mensagem, recomendacao, status, evidencia)
            VALUES ('esteira_gargalo_revisor','warn','dev','esteira_gargalo',
              format('Esteira sem publicar ha %s min: %s PR(s) revisadas esperando o aval do revisor (gargalo = revisor).', round(v_min), v_rev),
              'A varredura de 5 min do acionar-revisor acorda o revisor; conferir o run em Actions.','novo',
              jsonb_build_object('episodio',v_ep,'prs_revisor',v_rev));
          END IF;
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END IF;
    END IF;

    IF v_esp > 0 AND v_ult IS NOT NULL AND v_min >= 30 THEN
      v_txt := format('EMERGENCIA Esteira parada %s min, %s PRs prontas, gargalo=%s.', round(v_min), v_esp, v_gargalo);
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM erp_truth_alerts WHERE rule_id='esteira_parada_30' AND evidencia->>'episodio'=v_ep) THEN
          INSERT INTO erp_truth_alerts (rule_id, severity, area, tipo_divergencia, mensagem, recomendacao, status, evidencia)
          VALUES ('esteira_parada_30','critical','dev','esteira_parada',v_txt,
            'Acordar o ator-gargalo: revisor = rodar acionar-revisor; drenagem = destravar a fila.','novo',
            jsonb_build_object('episodio',v_ep,'gargalo',v_gargalo,'prs',v_esp));
          IF v_gargalo = 'drenagem' THEN
            INSERT INTO erp_agente_mensagem (para,de,tipo,assunto,corpo,requer_ok_ceo,enviado_por)
            VALUES ('gilberto-desenv','eng_chefe','tarefa','AUTO: EMERGENCIA esteira parada',
              v_txt||' Pare o que estiver fazendo e destrave a drenagem agora.',false,'eng_chefe');
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;

    IF v_esp > 0 AND v_ult IS NOT NULL AND v_min >= 45 THEN
      v_txt := format('EMERGENCIA Esteira parada %s min, %s PRs prontas, gargalo=%s', round(v_min), v_esp, v_gargalo);
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM erp_truth_alerts WHERE rule_id='esteira_parada_45' AND evidencia->>'episodio'=v_ep) THEN
          INSERT INTO erp_truth_alerts (rule_id, severity, area, tipo_divergencia, mensagem, recomendacao, status, evidencia)
          VALUES ('esteira_parada_45','critical','dev','esteira_parada',v_txt,
            'Abrir GitHub Actions e a fila de merge; decidir com o Eng. Chefe.','novo',
            jsonb_build_object('episodio',v_ep,'gargalo',v_gargalo,'prs',v_esp));
          SELECT email INTO v_email FROM users WHERE id = v_ceo;
          SELECT company_id INTO v_comp FROM user_companies WHERE user_id = v_ceo LIMIT 1;
          IF v_comp IS NOT NULL THEN
            INSERT INTO erp_notificacao_usuario (company_id, destinatario_id, tipo, titulo, mensagem, link, origem_tipo)
            VALUES (v_comp, v_ceo, 'alerta_ci', 'Esteira parada ha '||round(v_min)||' min', v_txt,
              'https://github.com/psgestaoecapital/erp-psgestao/actions', 'esteira_parada');
          END IF;
          IF v_email IS NOT NULL THEN
            PERFORM fn_enviar_email(v_email, 'contrato_evento', jsonb_build_object(
              'assunto','Esteira parada ha '||round(v_min)||' min - PS Gestao','titulo_email','Esteira de merge parada',
              'corpo',v_txt,'cta','Abrir o GitHub Actions','link','https://github.com/psgestaoecapital/erp-psgestao/actions',
              'idempotency_key','esteira-parada-'||v_ep));
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END IF;

  FOR c IN SELECT r.agente FROM erp_agente_rotina r WHERE r.aciona=true AND NOT public.fn__agente_lease_ativa(r.agente) LOOP
    BEGIN
      SELECT id INTO v_msg FROM erp_agente_mensagem WHERE para=c.agente AND tipo='tarefa' AND NOT arquivada AND status IN ('recebida','em_andamento') AND atualizado_em BETWEEN now()-interval '4 hours' AND now()-interval '15 minutes' ORDER BY atualizado_em LIMIT 1;
      IF v_msg IS NOT NULL THEN PERFORM public.fn_agente_acionar(v_msg); END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_monitor_merge_tick() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_monitor_merge_tick() TO service_role;
