-- NR-36 · #587 (Frioeste · CEO 04/10) · dia "conforme" com 60 de 100 min (16/09) e 80 de 100 (30/09).
-- Causa provada no dado (matrícula 1016): fn_nr36_apurar (a) calculava o devido sobre a jornada INTEIRA, sem descontar a
-- janela de almoço (o parâmetro almoco_interrompe_exposicao já existia e nenhuma linha o lia) e (b) deixava o dia
-- 'conforme' mesmo com pausas realizadas < devidas, quando nenhuma pausa registrada era < mínimo.
--
-- O que muda — SOMENTE para empresa cuja regra termica_253 tem almoco_interrompe_exposicao = true (sem o parâmetro,
-- ou false, o resultado é IDÊNTICO ao de hoje; nenhum default novo):
--  (a) exposição = jornada − intervalos entre as batidas (saída→volta: almoço) − pausas; devido = floor(exposição/gatilho);
--  (b) realizadas < devidas e nenhuma pausa < mínimo → 'pendente_confirmacao' motivo 'pausas_faltantes'
--      (nunca 'conforme' — RD-51 — e nunca 'desvio' por estimativa — RD-38).
-- Não reapura nada: a reapuração de setembro é passo separado, com backup (RD-55), depois do merge.

CREATE OR REPLACE FUNCTION public.fn_nr36_apurar(p_company_id uuid, p_dt_ini date, p_dt_fim date, p_cpf text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_linhas int:=0; v_reg record; v_param jsonb;
  v_gatilho int; v_pausa_min int; v_lim_inf numeric;
  v_desvios jsonb; v_devido int; v_realizado int; v_conformes int; v_insuf int; v_excesso int;
  v_status text; v_motivo text; v_pendente boolean; v_tem_pausa boolean;
  v_jor_ini timestamp; v_jor_fim timestamp; v_jornada_min numeric; v_pausas_min numeric; v_exposicao_min numeric;
  v_detalhe_pausas jsonb; v_almoco boolean; v_almoco_min numeric;
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  PERFORM public.fn_nr36_classificar_eventos(p_company_id);
  FOR v_reg IN
    SELECT e.company_id, e.tipo, c.id AS colaborador_id, d.cpf, d.data, d.worked_seconds, d.shift, r.parametros
    FROM public.nr36_funcionario_elegivel e
    JOIN public.ind_ponto_colaborador c ON c.id=e.colaborador_id
    JOIN public.nr36_pausa_regra r ON r.company_id=e.company_id AND r.tipo=e.tipo AND r.ativo
    JOIN public.ind_ponto_dia d ON d.company_id=e.company_id AND d.cpf=c.cpf AND d.data BETWEEN p_dt_ini AND p_dt_fim AND COALESCE(d.worked_seconds,0)>0
    WHERE e.company_id=p_company_id AND e.ativo AND (p_cpf IS NULL OR c.cpf = p_cpf) /* por_colaborador */
      AND EXISTS (SELECT 1 FROM public.nr36_upload u WHERE u.company_id=e.company_id AND COALESCE(u.status,'') NOT IN ('substituido','falhou','pendente') /* #107 so_processado */ AND d.data BETWEEN u.periodo_inicio AND u.periodo_fim)
  LOOP
    v_param := v_reg.parametros;
    IF v_reg.tipo <> 'termica_253' THEN
      DECLARE v_dev int; v_real int; v_tem_ab boolean; v_tem_fe boolean;
      BEGIN
        v_dev := public.fn_nr36_devido_min(v_reg.tipo, v_reg.worked_seconds, v_param);
        SELECT (COALESCE(sum(public.fn_nr36_duracao_seg(inicio, fim, fim_confirmado, duracao_seg) /* #272 */) FILTER (WHERE COALESCE(fim_confirmado,fim) IS NOT NULL),0)/60)::int,
               bool_or(COALESCE(fim_confirmado,fim) IS NOT NULL), bool_or(COALESCE(fim_confirmado,fim) IS NULL)
          INTO v_real, v_tem_fe, v_tem_ab
          FROM public.ind_ponto_pausa
         WHERE company_id=v_reg.company_id AND cpf=v_reg.cpf AND data=v_reg.data
           AND classe_evento IN ('pausa_normal','pausa_excesso');
        v_status := CASE WHEN NOT COALESCE(v_tem_fe,false) AND COALESCE(v_tem_ab,false) THEN 'aguardando_realizado'
                         WHEN NOT COALESCE(v_tem_fe,false) AND NOT COALESCE(v_tem_ab,false) THEN 'sem_dado'
                         WHEN COALESCE(v_real,0) >= v_dev THEN 'conforme' ELSE 'desvio' END;
        v_motivo := CASE WHEN v_status='sem_dado' THEN 'colaborador_sem_evento' ELSE NULL END;
        INSERT INTO public.nr36_pausa_apurada (company_id,colaborador_id,cpf,data,tipo,jornada_seg,devido_min,realizado_min,diferenca_min,status,detalhe,apurado_em)
        VALUES (v_reg.company_id,v_reg.colaborador_id,v_reg.cpf,v_reg.data,v_reg.tipo,v_reg.worked_seconds,v_dev,COALESCE(v_real,0),COALESCE(v_real,0)-v_dev,v_status,
          jsonb_build_object('motor','faixas','devido_min',v_dev,'realizado_min',COALESCE(v_real,0),'jornada',jsonb_build_object('shift',v_reg.shift),'tem_aberto',COALESCE(v_tem_ab,false),'sem_dado_motivo',v_motivo),now())
        ON CONFLICT (company_id,cpf,data,tipo) DO UPDATE SET jornada_seg=EXCLUDED.jornada_seg,devido_min=EXCLUDED.devido_min,realizado_min=EXCLUDED.realizado_min,diferenca_min=EXCLUDED.diferenca_min,status=EXCLUDED.status,detalhe=EXCLUDED.detalhe,colaborador_id=EXCLUDED.colaborador_id,apurado_em=now();
        v_linhas := v_linhas+1;
      END;
      CONTINUE;
    END IF;

    -- ==== térmica_253 ====
    v_gatilho := COALESCE((v_param->>'gatilho_min')::int,100);
    v_pausa_min := COALESCE((v_param->>'pausa_min')::int,20);
    v_lim_inf := COALESCE((v_param->>'limite_inferior_min')::numeric, v_pausa_min);  -- #76 limite inferior (vazio = a pausa)
    v_almoco := COALESCE((v_param->>'almoco_interrompe_exposicao')::boolean, false);  -- #587 só vale quando a empresa liga

    SELECT min((pt->>'datetime')::timestamp), max((pt->>'datetime')::timestamp)
      INTO v_jor_ini, v_jor_fim
      FROM public.ind_ponto_dia d2, jsonb_array_elements(d2.raw->'points') pt
     WHERE d2.company_id=v_reg.company_id AND d2.cpf=v_reg.cpf AND d2.data=v_reg.data;

    -- pendente: sem origem EFETIVA, 'indeterminado' OU 'estimado' (estimado NÃO fecha veredito — decisão CEO).
    -- #107: pausa fechada no relatório (normal/excesso/insuficiente) conta como 'registrado' mesmo sem carimbo.
    SELECT bool_or(public.fn_nr36_fim_origem_efetiva(fim, classe_evento, fim_origem) IS NULL
                   OR fim_origem IN ('indeterminado','estimado')), count(*)>0
      INTO v_pendente, v_tem_pausa
      FROM public.ind_ponto_pausa
     WHERE company_id=v_reg.company_id AND cpf=v_reg.cpf AND data=v_reg.data;

    IF v_jor_ini IS NULL THEN
      v_status := 'sem_dado'; v_motivo := 'sem_jornada_ponto';
      v_desvios := '[]'::jsonb; v_devido:=0; v_realizado:=0; v_conformes:=0; v_insuf:=0; v_excesso:=0; v_exposicao_min:=0; v_detalhe_pausas:='[]'::jsonb; v_almoco_min:=0;
    ELSIF COALESCE(v_pendente,false) THEN
      v_status := 'pendente_confirmacao'; v_motivo := 'pausa_sem_confirmacao';
      v_desvios := '[]'::jsonb; v_devido:=0; v_realizado:=0; v_conformes:=0; v_insuf:=0; v_excesso:=0; v_exposicao_min:=0; v_almoco_min:=0;
      -- detalhe RICO: mostra o fim de cada pausa (registrado/confirmado_ponto/estimado) e sem-fim quando NULL
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'de', to_char(inicio AT TIME ZONE 'America/Sao_Paulo','HH24:MI'),
          'ate', CASE WHEN COALESCE(fim_confirmado,fim) IS NOT NULL THEN to_char(COALESCE(fim_confirmado,fim) AT TIME ZONE 'America/Sao_Paulo','HH24:MI') ELSE NULL END,
          'min', CASE WHEN COALESCE(fim_confirmado,fim) IS NOT NULL THEN round(public.fn_nr36_duracao_seg(inicio, fim, fim_confirmado, duracao_seg) /* #272 *//60) ELSE NULL END,
          'classe', classe_evento, 'sem_saida', COALESCE(inicio_origem = 'sem_saida', false) /* #587 sem_saida */,
          'fim_origem', fim_origem,
          'fim_original', CASE WHEN fim IS NOT NULL THEN to_char(fim AT TIME ZONE 'America/Sao_Paulo','HH24:MI') ELSE NULL END
        ) ORDER BY inicio),'[]'::jsonb)
        INTO v_detalhe_pausas FROM public.ind_ponto_pausa WHERE company_id=v_reg.company_id AND cpf=v_reg.cpf AND data=v_reg.data;
    ELSE
      v_jornada_min := EXTRACT(EPOCH FROM (v_jor_fim - v_jor_ini))/60;
      SELECT
        COALESCE(sum(public.fn_nr36_duracao_seg(inicio, fim, fim_confirmado, duracao_seg) /* #272 *//60),0),
        count(*) FILTER (WHERE public.fn_nr36_duracao_seg(inicio, fim, fim_confirmado, duracao_seg) /* #272 *//60 >= v_lim_inf),
        count(*) FILTER (WHERE public.fn_nr36_duracao_seg(inicio, fim, fim_confirmado, duracao_seg) /* #272 *//60 < v_lim_inf),
        count(*) FILTER (WHERE classe_evento='pausa_excesso'),
        COALESCE(jsonb_agg(jsonb_build_object(
          'de', to_char(inicio AT TIME ZONE 'America/Sao_Paulo','HH24:MI'),
          'ate', to_char(COALESCE(fim_confirmado,fim) AT TIME ZONE 'America/Sao_Paulo','HH24:MI'),
          'min', round(public.fn_nr36_duracao_seg(inicio, fim, fim_confirmado, duracao_seg) /* #272 *//60),
          'classe', classe_evento, 'sem_saida', COALESCE(inicio_origem = 'sem_saida', false) /* #587 sem_saida */,
          'fim_origem', fim_origem,
          'fim_original', CASE WHEN fim IS NOT NULL THEN to_char(fim AT TIME ZONE 'America/Sao_Paulo','HH24:MI') ELSE NULL END
        ) ORDER BY inicio),'[]'::jsonb)
        INTO v_pausas_min, v_realizado, v_insuf, v_excesso, v_detalhe_pausas
        FROM public.ind_ponto_pausa
       WHERE company_id=v_reg.company_id AND cpf=v_reg.cpf AND data=v_reg.data
         AND COALESCE(fim_confirmado,fim) IS NOT NULL;
      v_conformes := v_realizado;
      -- #587 (a) almoço: intervalo entre a saída e a volta das batidas (2ª→3ª, 4ª→5ª…) não é exposição
      v_almoco_min := 0;
      IF v_almoco THEN
        SELECT COALESCE(sum(EXTRACT(EPOCH FROM (prox - ts))/60), 0) INTO v_almoco_min
          FROM (SELECT ts, lead(ts) OVER (ORDER BY ts) AS prox, row_number() OVER (ORDER BY ts) AS rn
                  FROM (SELECT (pt->>'datetime')::timestamp AS ts
                          FROM public.ind_ponto_dia d3, jsonb_array_elements(d3.raw->'points') pt
                         WHERE d3.company_id=v_reg.company_id AND d3.cpf=v_reg.cpf AND d3.data=v_reg.data) b) g
         WHERE prox IS NOT NULL AND rn % 2 = 0;
      END IF;
      v_exposicao_min := GREATEST(v_jornada_min - v_almoco_min - COALESCE(v_pausas_min,0), 0);
      v_devido := floor(v_exposicao_min / GREATEST(v_gatilho,1))::int;
      v_desvios := '[]'::jsonb;
      IF v_insuf > 0 THEN v_desvios := v_desvios || jsonb_build_object('tipo','pausa_insuficiente','quantidade',v_insuf); END IF;
      -- #86/#92: dia que EXIGIA pausa (devido>0) e não teve NENHUMA marcação de pausa não é 'conforme'
      -- (RD-51) nem 'desvio' (RD-38 — exposição é estimativa, fora do veredito). Vira pendência a confirmar.
      -- Jornada curta (devido=0) que não exigia pausa segue 'conforme'.
      -- #587 (b): realizadas < devidas, sem pausa < mínimo: pendente 'pausas_faltantes' (só com o parâmetro de almoço).
      v_status := CASE WHEN v_insuf > 0 THEN 'desvio'
                       WHEN NOT COALESCE(v_tem_pausa,false) AND v_devido > 0 THEN 'pendente_confirmacao'
                       WHEN v_almoco AND v_realizado < v_devido THEN 'pendente_confirmacao'
                       ELSE 'conforme' END;
      v_motivo := CASE WHEN v_status<>'pendente_confirmacao' THEN NULL
                       WHEN NOT COALESCE(v_tem_pausa,false) THEN 'sem_registro_pausa'
                       ELSE 'pausas_faltantes' END;
    END IF;

    INSERT INTO public.nr36_pausa_apurada (company_id,colaborador_id,cpf,data,tipo,jornada_seg,devido_min,realizado_min,diferenca_min,status,detalhe,apurado_em)
    VALUES (v_reg.company_id,v_reg.colaborador_id,v_reg.cpf,v_reg.data,v_reg.tipo,v_reg.worked_seconds,
      v_devido*v_pausa_min, v_realizado*v_pausa_min, (v_realizado-v_devido)*v_pausa_min, v_status,
      jsonb_build_object('motor','exposicao_ponto','regra',jsonb_build_object('gatilho_min',v_gatilho,'pausa_min',v_pausa_min,'versao','termica_253_v2'),
        'jornada',jsonb_build_object('shift',v_reg.shift,'inicio',to_char(v_jor_ini,'HH24:MI'),'fim',to_char(v_jor_fim,'HH24:MI'),'exposicao_min',round(v_exposicao_min))
          || CASE WHEN v_almoco AND v_almoco_min > 0 THEN jsonb_build_object('almoco_min',round(v_almoco_min)) ELSE '{}'::jsonb END,
        'pausas',v_detalhe_pausas,'pausas_devidas',v_devido,'pausas_realizadas',v_realizado,'conformes',v_conformes,
        'insuficientes',v_insuf,'excessos',v_excesso,'desvios',v_desvios,'sem_dado_motivo',v_motivo,
        'nao_realizada_estimado',jsonb_build_object('faltantes',GREATEST(v_devido-v_realizado,0),'exposicao_min',round(v_exposicao_min),'base','jornada_menos_pausas','estimado',true)),now())
    ON CONFLICT (company_id,cpf,data,tipo) DO UPDATE SET jornada_seg=EXCLUDED.jornada_seg,devido_min=EXCLUDED.devido_min,realizado_min=EXCLUDED.realizado_min,diferenca_min=EXCLUDED.diferenca_min,status=EXCLUDED.status,detalhe=EXCLUDED.detalhe,colaborador_id=EXCLUDED.colaborador_id,apurado_em=now();
    v_linhas := v_linhas+1;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'linhas',v_linhas);
END $function$;

REVOKE ALL ON FUNCTION public.fn_nr36_apurar(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_apurar(uuid, date, date, text) TO authenticated, service_role;
