-- ============================================================
-- SST ①.1 · fn_nr36_apurar — limita ao período importado + sub-tipa 'sem_dado'
-- ============================================================
-- Achado (RD-38) após o ①: reapurar sobre min..max de ind_ponto_dia gerava linhas do ANO
-- INTEIRO (jan–set, 251 dias) enquanto só agosto foi importado → 1.536 'sem_dado' de meses
-- que ninguém subiu. Ruído, não sinal; e "sem dado" solto parece bug.
--
-- Correções:
--  (a) a apuração só produz linha para dias DENTRO de um período importado (nr36_upload,
--      não substituído). Fora disso não gera linha — o vazio de período já é sinalizado à parte
--      pela fn_nr36_dias_sem_dado (banner "dias sem planilha importada").
--  (b) 'sem_dado' (dia dentro do período importado, mas o colaborador não tem evento) ganha
--      detalhe.sem_dado_motivo='colaborador_sem_evento' → a tela diz o motivo (regra 0e580f96),
--      diferente de "período não importado". Ações diferentes.
-- Com isso o universo da validadora cai de 1.741 para 255 (agosto), como esperado.

CREATE OR REPLACE FUNCTION public.fn_nr36_apurar(p_company_id uuid, p_dt_ini date, p_dt_fim date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_linhas int := 0;
  v_reg record; v_ev record;
  v_param jsonb; v_gatilho int; v_pausa_min int; v_curta_zera boolean;
  v_desvios jsonb; v_devidas int; v_realizadas int; v_conformes int; v_expo_max int;
  v_status text; v_tem_aberto boolean; v_tem_fechado boolean;
  v_devido int; v_realizado int; v_motivo text;
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  PERFORM public.fn_nr36_classificar_eventos(p_company_id);

  FOR v_reg IN
    SELECT e.company_id, e.tipo, c.id AS colaborador_id, d.cpf, d.data, d.worked_seconds, d.shift, r.parametros
    FROM public.nr36_funcionario_elegivel e
    JOIN public.ind_ponto_colaborador c ON c.id = e.colaborador_id
    JOIN public.nr36_pausa_regra r ON r.company_id = e.company_id AND r.tipo = e.tipo AND r.ativo
    JOIN public.ind_ponto_dia d ON d.company_id = e.company_id AND d.cpf = c.cpf
         AND d.data BETWEEN p_dt_ini AND p_dt_fim AND COALESCE(d.worked_seconds,0) > 0
    WHERE e.company_id = p_company_id AND e.ativo
      -- só dias DENTRO de um período efetivamente importado (não substituído)
      AND EXISTS (SELECT 1 FROM public.nr36_upload u
                   WHERE u.company_id = e.company_id AND COALESCE(u.status,'') <> 'substituido'
                     AND d.data BETWEEN u.periodo_inicio AND u.periodo_fim)
  LOOP
    v_param := v_reg.parametros;

    IF v_reg.tipo = 'termica_253' THEN
      v_gatilho    := COALESCE((v_param->>'gatilho_min')::int, 100);
      v_pausa_min  := COALESCE((v_param->>'pausa_min')::int, 20);
      v_curta_zera := COALESCE((v_param->>'pausa_curta_zera')::boolean, false);
      v_desvios := '[]'::jsonb; v_devidas := 0; v_realizadas := 0; v_conformes := 0; v_expo_max := 0;
      v_tem_aberto := false; v_tem_fechado := false;

      FOR v_ev IN
        SELECT inicio, fim, classe_evento, round(duracao_seg/60.0)::int AS dur_min
        FROM public.ind_ponto_pausa
        WHERE company_id = v_reg.company_id AND cpf = v_reg.cpf AND data = v_reg.data
        ORDER BY inicio
      LOOP
        IF v_ev.fim IS NULL THEN v_tem_aberto := true; CONTINUE; END IF;
        v_tem_fechado := true;
        IF v_ev.classe_evento = 'exposicao' THEN
          IF v_ev.dur_min > v_gatilho THEN
            v_devidas := v_devidas + floor(v_ev.dur_min::numeric / GREATEST(v_gatilho,1))::int;
            v_expo_max := GREATEST(v_expo_max, v_ev.dur_min);
            v_desvios := v_desvios || jsonb_build_object('tipo','excedeu_limite','de',to_char(v_ev.inicio,'HH24:MI'),
              'ate',to_char(v_ev.fim,'HH24:MI'),'minutos',v_ev.dur_min,'excedeu',v_ev.dur_min - v_gatilho);
          END IF;
        ELSE
          IF v_ev.dur_min < v_pausa_min THEN
            v_desvios := v_desvios || jsonb_build_object('tipo','pausa_insuficiente','inicio',to_char(v_ev.inicio,'HH24:MI'),
              'duracao_min',v_ev.dur_min,'minimo',v_pausa_min);
          ELSE v_realizadas := v_realizadas + 1; v_conformes := v_conformes + 1; END IF;
        END IF;
      END LOOP;

      IF v_devidas > v_realizadas THEN
        v_desvios := v_desvios || jsonb_build_object('tipo','pausa_nao_realizada','faltantes', v_devidas - v_realizadas);
      END IF;

      v_status := CASE
        WHEN NOT v_tem_fechado AND v_tem_aberto THEN 'aguardando_realizado'
        WHEN NOT v_tem_fechado AND NOT v_tem_aberto THEN 'sem_dado'
        WHEN jsonb_array_length(v_desvios) > 0 THEN 'desvio'
        ELSE 'conforme' END;
      v_motivo := CASE WHEN v_status = 'sem_dado' THEN 'colaborador_sem_evento' ELSE NULL END;

      INSERT INTO public.nr36_pausa_apurada
        (company_id, colaborador_id, cpf, data, tipo, jornada_seg, devido_min, realizado_min, diferenca_min, status, detalhe, apurado_em)
      VALUES (v_reg.company_id, v_reg.colaborador_id, v_reg.cpf, v_reg.data, v_reg.tipo, v_reg.worked_seconds,
        v_devidas * v_pausa_min, v_realizadas * v_pausa_min, (v_realizadas - v_devidas) * v_pausa_min, v_status,
        jsonb_build_object('motor','sequencial','jornada',jsonb_build_object('shift',v_reg.shift),
          'regra',jsonb_build_object('gatilho_min',v_gatilho,'pausa_min',v_pausa_min,'versao','termica_253',
                   'janela_exposicao',COALESCE(v_param->>'janela_exposicao','marcacao'),'pausa_curta_zera',v_curta_zera),
          'desvios',v_desvios,'pausas_devidas',v_devidas,'pausas_realizadas',v_realizadas,'conformes',v_conformes,
          'exposicao_maxima_min',v_expo_max,'tem_aberto',v_tem_aberto,'sem_dado_motivo',v_motivo), now())
      ON CONFLICT (company_id, cpf, data, tipo) DO UPDATE SET
        jornada_seg=EXCLUDED.jornada_seg, devido_min=EXCLUDED.devido_min, realizado_min=EXCLUDED.realizado_min,
        diferenca_min=EXCLUDED.diferenca_min, status=EXCLUDED.status, detalhe=EXCLUDED.detalhe,
        colaborador_id=EXCLUDED.colaborador_id, apurado_em=now();
      v_linhas := v_linhas + 1;

    ELSE
      v_devido := public.fn_nr36_devido_min(v_reg.tipo, v_reg.worked_seconds, v_param);
      SELECT (COALESCE(sum(duracao_seg) FILTER (WHERE fim IS NOT NULL),0)/60)::int,
             bool_or(fim IS NOT NULL), bool_or(fim IS NULL)
        INTO v_realizado, v_tem_fechado, v_tem_aberto
        FROM public.ind_ponto_pausa
        WHERE company_id=v_reg.company_id AND cpf=v_reg.cpf AND data=v_reg.data
          AND (classe_evento = 'pausa' OR classe_evento IS NULL);
      v_status := CASE
        WHEN NOT COALESCE(v_tem_fechado,false) AND COALESCE(v_tem_aberto,false) THEN 'aguardando_realizado'
        WHEN NOT COALESCE(v_tem_fechado,false) AND NOT COALESCE(v_tem_aberto,false) THEN 'sem_dado'
        WHEN COALESCE(v_realizado,0) >= v_devido THEN 'conforme'
        ELSE 'desvio' END;
      v_motivo := CASE WHEN v_status = 'sem_dado' THEN 'colaborador_sem_evento' ELSE NULL END;
      INSERT INTO public.nr36_pausa_apurada
        (company_id, colaborador_id, cpf, data, tipo, jornada_seg, devido_min, realizado_min, diferenca_min, status, detalhe, apurado_em)
      VALUES (v_reg.company_id, v_reg.colaborador_id, v_reg.cpf, v_reg.data, v_reg.tipo, v_reg.worked_seconds,
        v_devido, COALESCE(v_realizado,0), COALESCE(v_realizado,0) - v_devido, v_status,
        jsonb_build_object('motor','faixas','devido_min',v_devido,'realizado_min',COALESCE(v_realizado,0),
          'jornada',jsonb_build_object('shift',v_reg.shift),'tem_aberto',COALESCE(v_tem_aberto,false),'sem_dado_motivo',v_motivo), now())
      ON CONFLICT (company_id, cpf, data, tipo) DO UPDATE SET
        jornada_seg=EXCLUDED.jornada_seg, devido_min=EXCLUDED.devido_min, realizado_min=EXCLUDED.realizado_min,
        diferenca_min=EXCLUDED.diferenca_min, status=EXCLUDED.status, detalhe=EXCLUDED.detalhe,
        colaborador_id=EXCLUDED.colaborador_id, apurado_em=now();
      v_linhas := v_linhas + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'linhas', v_linhas);
END $fn$;

-- Limpa apurações órfãs de dias FORA de qualquer período importado (as 1.536 do teste não existem
-- em produção, mas se um reapuro anterior tiver gerado alguma, some — recalcula, não perde evento).
DELETE FROM public.nr36_pausa_apurada ap
 WHERE NOT EXISTS (SELECT 1 FROM public.nr36_upload u
                    WHERE u.company_id = ap.company_id AND COALESCE(u.status,'') <> 'substituido'
                      AND ap.data BETWEEN u.periodo_inicio AND u.periodo_fim)
   AND EXISTS (SELECT 1 FROM public.nr36_upload u2 WHERE u2.company_id = ap.company_id);
