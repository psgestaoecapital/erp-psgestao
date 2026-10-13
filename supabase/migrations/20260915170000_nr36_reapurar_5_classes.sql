-- ============================================================
-- SST ④ · reapuração com as 5 classes + exposição derivada do ponto (tira o veredito inflado)
-- ============================================================
-- Antes: exposição vinha do relógio de PAUSA (evento longo = exposição), e insuficiente/excesso/
-- esquecimento viravam "desvio" — 189 inflados. Agora:
--   • fim EFETIVO = COALESCE(fim_confirmado, fim) — RD-30: o fim original do relógio nunca é apagado;
--     o relatório mostra os dois (registro original × confirmado pela responsável).
--   • exposição = jornada do PONTO (1ª à última batida) menos as pausas. Sem batida no dia → NÃO
--     presume jornada: status 'sem_dado' com motivo 'sem_jornada_ponto'.
--   • só pausa_insuficiente (efetiva < pausa_min) e pausa devida não realizada são DESVIO. Excesso é
--     gestão (conforme). Dia com pausa pendente de confirmação → 'pendente_confirmacao', NUNCA desvio.
--   • fuso (contexto fe5485e9): pausa.inicio/fim é UTC real → AT TIME ZONE SP p/ casar com a batida.
-- Genérico por tenant. Não apaga nada (RD-30). O banner do ① sai quando esta apuração roda.

CREATE OR REPLACE FUNCTION public.fn_nr36_apurar(p_company_id uuid, p_dt_ini date, p_dt_fim date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_linhas int:=0; v_reg record; v_param jsonb;
  v_gatilho int; v_pausa_min int;
  v_desvios jsonb; v_devido int; v_realizado int; v_conformes int; v_insuf int; v_excesso int;
  v_status text; v_motivo text; v_pendente boolean; v_tem_pausa boolean;
  v_jor_ini timestamp; v_jor_fim timestamp; v_jornada_min numeric; v_pausas_min numeric; v_exposicao_min numeric;
  v_detalhe_pausas jsonb;
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  PERFORM public.fn_nr36_classificar_eventos(p_company_id);
  FOR v_reg IN
    SELECT e.company_id, e.tipo, c.id AS colaborador_id, d.cpf, d.data, d.worked_seconds, d.shift, r.parametros
    FROM public.nr36_funcionario_elegivel e
    JOIN public.ind_ponto_colaborador c ON c.id=e.colaborador_id
    JOIN public.nr36_pausa_regra r ON r.company_id=e.company_id AND r.tipo=e.tipo AND r.ativo
    JOIN public.ind_ponto_dia d ON d.company_id=e.company_id AND d.cpf=c.cpf AND d.data BETWEEN p_dt_ini AND p_dt_fim AND COALESCE(d.worked_seconds,0)>0
    WHERE e.company_id=p_company_id AND e.ativo
      AND EXISTS (SELECT 1 FROM public.nr36_upload u WHERE u.company_id=e.company_id AND COALESCE(u.status,'')<>'substituido' AND d.data BETWEEN u.periodo_inicio AND u.periodo_fim)
  LOOP
    v_param := v_reg.parametros;
    IF v_reg.tipo <> 'termica_253' THEN
      -- psicofisiológica (motor faixas) — usa as pausas conformes (efetivas) e o fim confirmado.
      DECLARE v_dev int; v_real int; v_tem_ab boolean; v_tem_fe boolean;
      BEGIN
        v_dev := public.fn_nr36_devido_min(v_reg.tipo, v_reg.worked_seconds, v_param);
        SELECT (COALESCE(sum(EXTRACT(EPOCH FROM (COALESCE(fim_confirmado,fim) - inicio))) FILTER (WHERE COALESCE(fim_confirmado,fim) IS NOT NULL),0)/60)::int,
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

    -- jornada do PONTO (1ª à última batida, hora local). Sem batida → sem jornada.
    SELECT min((pt->>'datetime')::timestamp), max((pt->>'datetime')::timestamp)
      INTO v_jor_ini, v_jor_fim
      FROM public.ind_ponto_dia d2, jsonb_array_elements(d2.raw->'points') pt
     WHERE d2.company_id=v_reg.company_id AND d2.cpf=v_reg.cpf AND d2.data=v_reg.data;

    -- pausa pendente de confirmação? (nao_fechada/aberta sem fim_origem, ou 'indeterminado')
    SELECT bool_or(fim_origem IS NULL OR fim_origem='indeterminado'), count(*)>0
      INTO v_pendente, v_tem_pausa
      FROM public.ind_ponto_pausa
     WHERE company_id=v_reg.company_id AND cpf=v_reg.cpf AND data=v_reg.data;

    IF v_jor_ini IS NULL THEN
      v_status := 'sem_dado'; v_motivo := 'sem_jornada_ponto';   -- NUNCA presume jornada padrão
      v_desvios := '[]'::jsonb; v_devido:=0; v_realizado:=0; v_conformes:=0; v_insuf:=0; v_excesso:=0; v_exposicao_min:=0; v_detalhe_pausas:='[]'::jsonb;
    ELSIF COALESCE(v_pendente,false) THEN
      v_status := 'pendente_confirmacao'; v_motivo := 'pausa_sem_confirmacao';
      v_desvios := '[]'::jsonb; v_devido:=0; v_realizado:=0; v_conformes:=0; v_insuf:=0; v_excesso:=0; v_exposicao_min:=0;
      SELECT COALESCE(jsonb_agg(jsonb_build_object('inicio',to_char(inicio AT TIME ZONE 'America/Sao_Paulo','HH24:MI'),'classe',classe_evento,'fim_origem',fim_origem) ORDER BY inicio),'[]'::jsonb)
        INTO v_detalhe_pausas FROM public.ind_ponto_pausa WHERE company_id=v_reg.company_id AND cpf=v_reg.cpf AND data=v_reg.data;
    ELSE
      -- todas as pausas têm fim efetivo → calcula
      v_jornada_min := EXTRACT(EPOCH FROM (v_jor_fim - v_jor_ini))/60;
      -- pausas efetivas: conforme (>= pausa_min) × insuficiente (< pausa_min); soma de duração; detalhe com origem
      SELECT
        COALESCE(sum(EXTRACT(EPOCH FROM (COALESCE(fim_confirmado,fim) - inicio))/60),0),
        count(*) FILTER (WHERE EXTRACT(EPOCH FROM (COALESCE(fim_confirmado,fim) - inicio))/60 >= v_pausa_min),
        count(*) FILTER (WHERE EXTRACT(EPOCH FROM (COALESCE(fim_confirmado,fim) - inicio))/60 < v_pausa_min),
        count(*) FILTER (WHERE classe_evento='pausa_excesso'),
        COALESCE(jsonb_agg(jsonb_build_object(
          'de', to_char(inicio AT TIME ZONE 'America/Sao_Paulo','HH24:MI'),
          'ate', to_char(COALESCE(fim_confirmado,fim) AT TIME ZONE 'America/Sao_Paulo','HH24:MI'),
          'min', round(EXTRACT(EPOCH FROM (COALESCE(fim_confirmado,fim) - inicio))/60),
          'classe', classe_evento,
          'fim_origem', fim_origem,                         -- registrado × confirmado_ponto × confirmado_manual
          'fim_original', CASE WHEN fim IS NOT NULL THEN to_char(fim AT TIME ZONE 'America/Sao_Paulo','HH24:MI') ELSE NULL END
        ) ORDER BY inicio),'[]'::jsonb)
        INTO v_pausas_min, v_realizado, v_insuf, v_excesso, v_detalhe_pausas
        FROM public.ind_ponto_pausa
       WHERE company_id=v_reg.company_id AND cpf=v_reg.cpf AND data=v_reg.data
         AND COALESCE(fim_confirmado,fim) IS NOT NULL;
      v_conformes := v_realizado;
      -- exposição = jornada − pausas. É ESTIMATIVA: o gatilho NR-36 é por trabalho CONTÍNUO (almoço
      -- zera a contagem), e span×trabalhado ainda diverge (prova: 310×228). Por RD-38 (não supor)
      -- e "estimado ≠ registrado", a pausa devida não realizada NÃO entra no veredito legal — fica
      -- gravada no detalhe como estimativa, visível e separada, até o modelo de exposição contínua
      -- ser validado. O painel mostra o estimado rotulado, nunca somado ao desvio.
      v_exposicao_min := GREATEST(v_jornada_min - COALESCE(v_pausas_min,0), 0);
      v_devido := floor(v_exposicao_min / GREATEST(v_gatilho,1))::int;
      -- DESVIO LEGAL (provado no dado, sem supor) = só pausa_insuficiente (pausa feita, curta demais).
      -- Excesso = gestão (conforme). Não-realizada = estimativa (fora do veredito, ver acima).
      v_desvios := '[]'::jsonb;
      IF v_insuf > 0 THEN v_desvios := v_desvios || jsonb_build_object('tipo','pausa_insuficiente','quantidade',v_insuf); END IF;
      v_status := CASE WHEN v_insuf > 0 THEN 'desvio' ELSE 'conforme' END;
      v_motivo := NULL;
    END IF;

    INSERT INTO public.nr36_pausa_apurada (company_id,colaborador_id,cpf,data,tipo,jornada_seg,devido_min,realizado_min,diferenca_min,status,detalhe,apurado_em)
    VALUES (v_reg.company_id,v_reg.colaborador_id,v_reg.cpf,v_reg.data,v_reg.tipo,v_reg.worked_seconds,
      v_devido*v_pausa_min, v_realizado*v_pausa_min, (v_realizado-v_devido)*v_pausa_min, v_status,
      jsonb_build_object('motor','exposicao_ponto','regra',jsonb_build_object('gatilho_min',v_gatilho,'pausa_min',v_pausa_min,'versao','termica_253_v2'),
        'jornada',jsonb_build_object('shift',v_reg.shift,'inicio',to_char(v_jor_ini,'HH24:MI'),'fim',to_char(v_jor_fim,'HH24:MI'),'exposicao_min',round(v_exposicao_min)),
        'pausas',v_detalhe_pausas,'pausas_devidas',v_devido,'pausas_realizadas',v_realizado,'conformes',v_conformes,
        'insuficientes',v_insuf,'excessos',v_excesso,'desvios',v_desvios,'sem_dado_motivo',v_motivo,
        -- estimativa (fora do veredito legal, RD-38): pausas devidas pela exposição que não foram feitas
        'nao_realizada_estimado',jsonb_build_object('faltantes',GREATEST(v_devido-v_realizado,0),'exposicao_min',round(v_exposicao_min),'base','jornada_menos_pausas','estimado',true)),now())
    ON CONFLICT (company_id,cpf,data,tipo) DO UPDATE SET jornada_seg=EXCLUDED.jornada_seg,devido_min=EXCLUDED.devido_min,realizado_min=EXCLUDED.realizado_min,diferenca_min=EXCLUDED.diferenca_min,status=EXCLUDED.status,detalhe=EXCLUDED.detalhe,colaborador_id=EXCLUDED.colaborador_id,apurado_em=now();
    v_linhas := v_linhas+1;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'linhas',v_linhas);
END $function$;

-- Reconciliação: mostra POR QUE o número caiu (a queda não é maquiagem). Conta os eventos de pausa
-- por classe no período + os desvios da apuração, e resume: esquecimento (tratado) × excesso (gestão)
-- × insuficiente (legal). Genérica por tenant.
CREATE OR REPLACE FUNCTION public.fn_nr36_reconciliacao(p_company_id uuid, p_dt_ini date, p_dt_fim date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_classes jsonb; v_dias_desvio int; v_dias_pendente int; v_dias_conforme int; v_dias_sem_dado int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT jsonb_object_agg(classe_evento, n) INTO v_classes
    FROM (SELECT classe_evento, count(*) n FROM public.ind_ponto_pausa
          WHERE company_id=p_company_id AND data BETWEEN p_dt_ini AND p_dt_fim GROUP BY 1) x;
  SELECT count(*) FILTER (WHERE status='desvio'), count(*) FILTER (WHERE status='pendente_confirmacao'),
         count(*) FILTER (WHERE status='conforme'), count(*) FILTER (WHERE status='sem_dado')
    INTO v_dias_desvio, v_dias_pendente, v_dias_conforme, v_dias_sem_dado
    FROM public.nr36_pausa_apurada
   WHERE company_id=p_company_id AND tipo='termica_253' AND data BETWEEN p_dt_ini AND p_dt_fim;
  RETURN jsonb_build_object('ok', true,
    'eventos_por_classe', COALESCE(v_classes,'{}'::jsonb),
    'leitura', jsonb_build_object(
      'esquecimento_tratado', COALESCE((v_classes->>'pausa_nao_fechada')::int,0) + COALESCE((v_classes->>'pausa_aberta')::int,0),
      'excesso_gestao_nao_infracao', COALESCE((v_classes->>'pausa_excesso')::int,0),
      'insuficiente_legal', COALESCE((v_classes->>'pausa_insuficiente')::int,0)),
    'dias', jsonb_build_object('desvio', v_dias_desvio, 'pendente_confirmacao', v_dias_pendente, 'conforme', v_dias_conforme, 'sem_dado', v_dias_sem_dado));
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_nr36_reconciliacao(uuid, date, date) TO authenticated;
