-- ============================================================
-- SST · sinal de conflito ponto×exposição + painel de GESTÃO (#67)
-- ============================================================
-- Achado (RD-38): 87 de 120 desvios (72,5%) da validadora têm uma MARCAÇÃO DE PONTO dentro do
-- período de exposição. Ex.: exposição contínua 07:42–11:59, mas o ponto registra batida 09:25.
-- Se aquela batida foi pausa real, a exposição não foi contínua — e um advogado da empresa usaria
-- isso para derrubar o laudo no MTE. O motor NÃO decide: SINALIZA o conflito e deixa o SST confirmar.
--
-- Este PR:
--  (a) o motor marca, em cada desvio de exposição, as marcações de ponto internas (hora local) e
--      um flag de dia tem_conflito_ponto → as 3 saídas (relatório #65, supervisão #68, painel #67) mostram.
--  (b) fn_nr36_painel_gestao: a visão gerencial do #67 (contagem, tendência, setor, repetentes,
--      tipo predominante, dias sem dado, casos com conflito). SEM valor monetário (655bb74b).
-- Reapurar após o deploy.

CREATE OR REPLACE FUNCTION public.fn_nr36_apurar(p_company_id uuid, p_dt_ini date, p_dt_fim date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_linhas int:=0; v_reg record; v_ev record; v_param jsonb;
  v_gatilho int; v_pausa_min int; v_curta_zera boolean;
  v_desvios jsonb; v_devidas int; v_realizadas int; v_conformes int; v_expo_max int;
  v_status text; v_tem_aberto boolean; v_tem_fechado boolean; v_devido int; v_realizado int; v_motivo text;
  v_marc_int jsonb; v_tem_conflito boolean;
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
    IF v_reg.tipo='termica_253' THEN
      v_gatilho:=COALESCE((v_param->>'gatilho_min')::int,100); v_pausa_min:=COALESCE((v_param->>'pausa_min')::int,20); v_curta_zera:=COALESCE((v_param->>'pausa_curta_zera')::boolean,false);
      v_desvios:='[]'::jsonb; v_devidas:=0; v_realizadas:=0; v_conformes:=0; v_expo_max:=0; v_tem_aberto:=false; v_tem_fechado:=false; v_tem_conflito:=false;
      FOR v_ev IN SELECT inicio,fim,classe_evento,round(duracao_seg/60.0)::int AS dur_min FROM public.ind_ponto_pausa WHERE company_id=v_reg.company_id AND cpf=v_reg.cpf AND data=v_reg.data ORDER BY inicio LOOP
        IF v_ev.fim IS NULL THEN v_tem_aberto:=true; CONTINUE; END IF;
        v_tem_fechado:=true;
        IF v_ev.classe_evento='exposicao' THEN
          IF v_ev.dur_min>v_gatilho THEN
            v_devidas:=v_devidas+floor(v_ev.dur_min::numeric/GREATEST(v_gatilho,1))::int; v_expo_max:=GREATEST(v_expo_max,v_ev.dur_min);
            -- marcações de ponto DENTRO desta exposição (hora local) → conflito a confirmar
            SELECT jsonb_agg(to_char(mm.datetime AT TIME ZONE 'UTC','HH24:MI') ORDER BY mm.datetime) INTO v_marc_int
              FROM public.ind_ponto_marcacao mm
              WHERE mm.company_id=v_reg.company_id AND mm.cpf=v_reg.cpf AND mm.data=v_reg.data
                AND (mm.datetime AT TIME ZONE 'UTC') > (v_ev.inicio AT TIME ZONE 'America/Sao_Paulo')
                AND (mm.datetime AT TIME ZONE 'UTC') < (v_ev.fim    AT TIME ZONE 'America/Sao_Paulo');
            IF v_marc_int IS NOT NULL THEN v_tem_conflito:=true; END IF;
            v_desvios:=v_desvios||jsonb_build_object('tipo','excedeu_limite',
              'de', to_char(v_ev.inicio AT TIME ZONE 'America/Sao_Paulo','HH24:MI'),
              'ate',to_char(v_ev.fim    AT TIME ZONE 'America/Sao_Paulo','HH24:MI'),
              'minutos',v_ev.dur_min,'excedeu',v_ev.dur_min-v_gatilho,
              'marcacao_interna', COALESCE(v_marc_int,'[]'::jsonb));
          END IF;
        ELSE
          IF v_ev.dur_min<v_pausa_min THEN
            v_desvios:=v_desvios||jsonb_build_object('tipo','pausa_insuficiente','inicio',to_char(v_ev.inicio AT TIME ZONE 'America/Sao_Paulo','HH24:MI'),'duracao_min',v_ev.dur_min,'minimo',v_pausa_min);
          ELSE v_realizadas:=v_realizadas+1; v_conformes:=v_conformes+1; END IF;
        END IF;
      END LOOP;
      IF v_devidas>v_realizadas THEN v_desvios:=v_desvios||jsonb_build_object('tipo','pausa_nao_realizada','faltantes',v_devidas-v_realizadas); END IF;
      v_status:=CASE WHEN NOT v_tem_fechado AND v_tem_aberto THEN 'aguardando_realizado' WHEN NOT v_tem_fechado AND NOT v_tem_aberto THEN 'sem_dado' WHEN jsonb_array_length(v_desvios)>0 THEN 'desvio' ELSE 'conforme' END;
      v_motivo:=CASE WHEN v_status='sem_dado' THEN 'colaborador_sem_evento' ELSE NULL END;
      INSERT INTO public.nr36_pausa_apurada (company_id,colaborador_id,cpf,data,tipo,jornada_seg,devido_min,realizado_min,diferenca_min,status,detalhe,apurado_em)
      VALUES (v_reg.company_id,v_reg.colaborador_id,v_reg.cpf,v_reg.data,v_reg.tipo,v_reg.worked_seconds,v_devidas*v_pausa_min,v_realizadas*v_pausa_min,(v_realizadas-v_devidas)*v_pausa_min,v_status,
        jsonb_build_object('motor','sequencial','jornada',jsonb_build_object('shift',v_reg.shift),
          'regra',jsonb_build_object('gatilho_min',v_gatilho,'pausa_min',v_pausa_min,'versao','termica_253','janela_exposicao',COALESCE(v_param->>'janela_exposicao','marcacao'),'pausa_curta_zera',v_curta_zera),
          'desvios',v_desvios,'pausas_devidas',v_devidas,'pausas_realizadas',v_realizadas,'conformes',v_conformes,'exposicao_maxima_min',v_expo_max,'tem_aberto',v_tem_aberto,'sem_dado_motivo',v_motivo,'tem_conflito_ponto',v_tem_conflito),now())
      ON CONFLICT (company_id,cpf,data,tipo) DO UPDATE SET jornada_seg=EXCLUDED.jornada_seg,devido_min=EXCLUDED.devido_min,realizado_min=EXCLUDED.realizado_min,diferenca_min=EXCLUDED.diferenca_min,status=EXCLUDED.status,detalhe=EXCLUDED.detalhe,colaborador_id=EXCLUDED.colaborador_id,apurado_em=now();
      v_linhas:=v_linhas+1;
    ELSE
      v_devido:=public.fn_nr36_devido_min(v_reg.tipo,v_reg.worked_seconds,v_param);
      SELECT (COALESCE(sum(duracao_seg) FILTER (WHERE fim IS NOT NULL),0)/60)::int, bool_or(fim IS NOT NULL), bool_or(fim IS NULL) INTO v_realizado,v_tem_fechado,v_tem_aberto FROM public.ind_ponto_pausa WHERE company_id=v_reg.company_id AND cpf=v_reg.cpf AND data=v_reg.data AND (classe_evento='pausa' OR classe_evento IS NULL);
      v_status:=CASE WHEN NOT COALESCE(v_tem_fechado,false) AND COALESCE(v_tem_aberto,false) THEN 'aguardando_realizado' WHEN NOT COALESCE(v_tem_fechado,false) AND NOT COALESCE(v_tem_aberto,false) THEN 'sem_dado' WHEN COALESCE(v_realizado,0)>=v_devido THEN 'conforme' ELSE 'desvio' END;
      v_motivo:=CASE WHEN v_status='sem_dado' THEN 'colaborador_sem_evento' ELSE NULL END;
      INSERT INTO public.nr36_pausa_apurada (company_id,colaborador_id,cpf,data,tipo,jornada_seg,devido_min,realizado_min,diferenca_min,status,detalhe,apurado_em)
      VALUES (v_reg.company_id,v_reg.colaborador_id,v_reg.cpf,v_reg.data,v_reg.tipo,v_reg.worked_seconds,v_devido,COALESCE(v_realizado,0),COALESCE(v_realizado,0)-v_devido,v_status,
        jsonb_build_object('motor','faixas','devido_min',v_devido,'realizado_min',COALESCE(v_realizado,0),'jornada',jsonb_build_object('shift',v_reg.shift),'tem_aberto',COALESCE(v_tem_aberto,false),'sem_dado_motivo',v_motivo),now())
      ON CONFLICT (company_id,cpf,data,tipo) DO UPDATE SET jornada_seg=EXCLUDED.jornada_seg,devido_min=EXCLUDED.devido_min,realizado_min=EXCLUDED.realizado_min,diferenca_min=EXCLUDED.diferenca_min,status=EXCLUDED.status,detalhe=EXCLUDED.detalhe,colaborador_id=EXCLUDED.colaborador_id,apurado_em=now();
      v_linhas:=v_linhas+1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'linhas',v_linhas);
END $fn$;

-- Painel de GESTÃO (#67): contagem, tendência, setor, repetentes, tipo predominante, dias sem dado,
-- casos com conflito de ponto. SEM valor monetário (655bb74b) — só contagem e nome de setor.
CREATE OR REPLACE FUNCTION public.fn_nr36_painel_gestao(p_company_id uuid, p_dt_ini date, p_dt_fim date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v jsonb; BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  SELECT jsonb_build_object(
    'por_status', (SELECT jsonb_object_agg(status,n) FROM (SELECT status,count(*) n FROM nr36_pausa_apurada WHERE company_id=p_company_id AND data BETWEEN p_dt_ini AND p_dt_fim GROUP BY 1) s),
    'tendencia_semana', (SELECT jsonb_agg(jsonb_build_object('semana',sem,'desvios',n) ORDER BY sem) FROM (SELECT to_char(date_trunc('week',data),'YYYY-MM-DD') sem, count(*) n FROM nr36_pausa_apurada WHERE company_id=p_company_id AND status='desvio' AND data BETWEEN p_dt_ini AND p_dt_fim GROUP BY 1) t),
    'por_setor', (SELECT jsonb_agg(jsonb_build_object('setor',COALESCE(setor,'(sem setor)'),'desvios',n) ORDER BY n DESC) FROM (SELECT c.departamento setor, count(*) n FROM nr36_pausa_apurada ap JOIN ind_ponto_colaborador c ON c.id=ap.colaborador_id WHERE ap.company_id=p_company_id AND ap.status='desvio' AND ap.data BETWEEN p_dt_ini AND p_dt_fim GROUP BY 1) st),
    'repetentes', (SELECT jsonb_agg(jsonb_build_object('nome',nome,'cpf',cpf,'dias_desvio',n) ORDER BY n DESC) FROM (SELECT c.nome, ap.cpf, count(*) n FROM nr36_pausa_apurada ap JOIN ind_ponto_colaborador c ON c.id=ap.colaborador_id WHERE ap.company_id=p_company_id AND ap.status='desvio' AND ap.data BETWEEN p_dt_ini AND p_dt_fim GROUP BY 1,2 HAVING count(*)>=2) rp),
    'tipo_predominante', (SELECT jsonb_object_agg(tipo,n) FROM (SELECT dv->>'tipo' tipo, count(*) n FROM nr36_pausa_apurada ap, jsonb_array_elements(COALESCE(ap.detalhe->'desvios','[]'::jsonb)) dv WHERE ap.company_id=p_company_id AND ap.status='desvio' AND ap.data BETWEEN p_dt_ini AND p_dt_fim GROUP BY 1) tp),
    'sem_dado', (SELECT jsonb_build_object('total', count(*) FILTER (WHERE status='sem_dado'), 'colaborador_sem_evento', count(*) FILTER (WHERE status='sem_dado' AND detalhe->>'sem_dado_motivo'='colaborador_sem_evento')) FROM nr36_pausa_apurada WHERE company_id=p_company_id AND data BETWEEN p_dt_ini AND p_dt_fim),
    'com_conflito_ponto', (SELECT count(*) FROM nr36_pausa_apurada WHERE company_id=p_company_id AND status='desvio' AND (detalhe->>'tem_conflito_ponto')::boolean IS TRUE AND data BETWEEN p_dt_ini AND p_dt_fim)
  ) INTO v;
  RETURN jsonb_build_object('ok',true,'painel',v);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_nr36_painel_gestao(uuid,date,date) TO authenticated;
