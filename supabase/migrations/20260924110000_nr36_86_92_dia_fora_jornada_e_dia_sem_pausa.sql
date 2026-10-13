-- #86 + #92 (Frioeste · SST · segurancadotrabalho) — pausas térmicas: dois ajustes provados no dado.
-- Autoria: sessão Claude (correção a partir dos exemplos do chamado; RD-38, provado no dado do Breno/Frioeste).
--
-- Ajuste (1) — "dia sem planilha" em sábado/domingo/feriado FORA da jornada:
--   fn_nr36_dias_sem_dado marcava como pendência de subir relatório TODO dia que tinha alguma linha em
--   ind_ponto_dia e nenhuma pausa importada — sem exigir que fosse um dia em que colaborador ELEGÍVEL à
--   NR-36 tivesse de fato trabalhado. Prova (Frioeste, set/2026): 05/09(sáb), 07/09(feriado), 12/09(sáb),
--   13/09(dom), 20/09(dom) apareciam como "sem planilha" com n_elegivel_trabalhou=0 (só batidas avulsas de
--   não-elegíveis); 15/09 e 24/09, com 12 e 8 elegíveis trabalhando, são lacunas REAIS. Correção: só conta
--   como "sem planilha" o dia em que um elegível ATIVO trabalhou (worked_seconds>0) e não há pausa importada.
--
-- Ajuste (2) — dia térmica SEM NENHUMA marcação de pausa aparecendo como "conforme":
--   no motor (fn_nr36_apurar, ramo térmica_253/ELSE), um dia com jornada longa o bastante para EXIGIR pausa
--   (v_devido>0) mas com ZERO eventos de pausa (v_tem_pausa=false) caía em 'conforme' porque só
--   pausa_insuficiente virava desvio — a não-realizada ficava só como estimativa no detalhe. Prova: Breno
--   15/09 (devido 120, pausas=[]) e 16/09 (devido 60, pausas=[]) marcados 'conforme'; 17/09 (devido 0) é
--   conforme legítimo. Correção (RD-51/RD-38): esse dia vira 'pendente_confirmacao' (motivo
--   'sem_registro_pausa') — nunca 'conforme' (não sabemos se houve pausa) e nunca 'desvio' (a exposição é
--   estimativa, fora do veredito legal). Jornada curta que não exigia pausa (devido=0) segue 'conforme'.
--   O dia passa a compor o pior-status do painel e a aparecer na Supervisão.
--
-- Aplicação nos dados existentes: as funções são recalculadas em tempo de LEITURA (fn_nr36_dias_sem_dado)
-- ou na próxima apuração. Para refletir o (2) em set/2026, o operador clica "Reapurar período" no Painel
-- (fn_nr36_apurar roda com a sessão do usuário — fn_nr36_assert exige acesso, por isso NÃO reapuramos aqui).

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (1) dias sem planilha: só dia em que um ELEGÍVEL ATIVO trabalhou (worked_seconds>0) sem pausa importada
-- ─────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_dias_sem_dado(p_company_id uuid, p_dt_ini date, p_dt_fim date)
 RETURNS SETOF date LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT d::date FROM generate_series(p_dt_ini, p_dt_fim, interval '1 day') d
   WHERE EXISTS (
           SELECT 1
             FROM public.ind_ponto_dia pd
             JOIN public.ind_ponto_colaborador c
               ON c.company_id = pd.company_id AND c.cpf = pd.cpf
             JOIN public.nr36_funcionario_elegivel e
               ON e.company_id = pd.company_id AND e.colaborador_id = c.id AND e.ativo
            WHERE pd.company_id = p_company_id
              AND pd.data = d::date
              AND COALESCE(pd.worked_seconds, 0) > 0     -- dia em que o elegível de fato trabalhou (exclui sáb/dom/feriado sem jornada)
         )
     AND NOT EXISTS (SELECT 1 FROM public.ind_ponto_pausa pp WHERE pp.company_id = p_company_id AND pp.data = d::date)
   ORDER BY d;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (2) motor: dia térmica com pausa DEVIDA e ZERO registro de pausa → pendente_confirmacao (não conforme,
--     não desvio). Idêntico à versão vigente (20260915210000), muda só o rótulo do ramo ELSE.
-- ─────────────────────────────────────────────────────────────────────────────────────────
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

    SELECT min((pt->>'datetime')::timestamp), max((pt->>'datetime')::timestamp)
      INTO v_jor_ini, v_jor_fim
      FROM public.ind_ponto_dia d2, jsonb_array_elements(d2.raw->'points') pt
     WHERE d2.company_id=v_reg.company_id AND d2.cpf=v_reg.cpf AND d2.data=v_reg.data;

    -- pendente: sem fim_origem, 'indeterminado' OU 'estimado' (estimado NÃO fecha veredito — decisão CEO)
    SELECT bool_or(fim_origem IS NULL OR fim_origem IN ('indeterminado','estimado')), count(*)>0
      INTO v_pendente, v_tem_pausa
      FROM public.ind_ponto_pausa
     WHERE company_id=v_reg.company_id AND cpf=v_reg.cpf AND data=v_reg.data;

    IF v_jor_ini IS NULL THEN
      v_status := 'sem_dado'; v_motivo := 'sem_jornada_ponto';
      v_desvios := '[]'::jsonb; v_devido:=0; v_realizado:=0; v_conformes:=0; v_insuf:=0; v_excesso:=0; v_exposicao_min:=0; v_detalhe_pausas:='[]'::jsonb;
    ELSIF COALESCE(v_pendente,false) THEN
      v_status := 'pendente_confirmacao'; v_motivo := 'pausa_sem_confirmacao';
      v_desvios := '[]'::jsonb; v_devido:=0; v_realizado:=0; v_conformes:=0; v_insuf:=0; v_excesso:=0; v_exposicao_min:=0;
      -- detalhe RICO: mostra o fim de cada pausa (registrado/confirmado_ponto/estimado) e sem-fim quando NULL
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'de', to_char(inicio AT TIME ZONE 'America/Sao_Paulo','HH24:MI'),
          'ate', CASE WHEN COALESCE(fim_confirmado,fim) IS NOT NULL THEN to_char(COALESCE(fim_confirmado,fim) AT TIME ZONE 'America/Sao_Paulo','HH24:MI') ELSE NULL END,
          'min', CASE WHEN COALESCE(fim_confirmado,fim) IS NOT NULL THEN round(EXTRACT(EPOCH FROM (COALESCE(fim_confirmado,fim) - inicio))/60) ELSE NULL END,
          'classe', classe_evento,
          'fim_origem', fim_origem,
          'fim_original', CASE WHEN fim IS NOT NULL THEN to_char(fim AT TIME ZONE 'America/Sao_Paulo','HH24:MI') ELSE NULL END
        ) ORDER BY inicio),'[]'::jsonb)
        INTO v_detalhe_pausas FROM public.ind_ponto_pausa WHERE company_id=v_reg.company_id AND cpf=v_reg.cpf AND data=v_reg.data;
    ELSE
      v_jornada_min := EXTRACT(EPOCH FROM (v_jor_fim - v_jor_ini))/60;
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
          'fim_origem', fim_origem,
          'fim_original', CASE WHEN fim IS NOT NULL THEN to_char(fim AT TIME ZONE 'America/Sao_Paulo','HH24:MI') ELSE NULL END
        ) ORDER BY inicio),'[]'::jsonb)
        INTO v_pausas_min, v_realizado, v_insuf, v_excesso, v_detalhe_pausas
        FROM public.ind_ponto_pausa
       WHERE company_id=v_reg.company_id AND cpf=v_reg.cpf AND data=v_reg.data
         AND COALESCE(fim_confirmado,fim) IS NOT NULL;
      v_conformes := v_realizado;
      v_exposicao_min := GREATEST(v_jornada_min - COALESCE(v_pausas_min,0), 0);
      v_devido := floor(v_exposicao_min / GREATEST(v_gatilho,1))::int;
      v_desvios := '[]'::jsonb;
      IF v_insuf > 0 THEN v_desvios := v_desvios || jsonb_build_object('tipo','pausa_insuficiente','quantidade',v_insuf); END IF;
      -- #86/#92: dia que EXIGIA pausa (devido>0) e não teve NENHUMA marcação de pausa não é 'conforme'
      -- (RD-51) nem 'desvio' (RD-38 — exposição é estimativa, fora do veredito). Vira pendência a confirmar.
      -- Jornada curta (devido=0) que não exigia pausa segue 'conforme'.
      v_status := CASE WHEN v_insuf > 0 THEN 'desvio'
                       WHEN NOT COALESCE(v_tem_pausa,false) AND v_devido > 0 THEN 'pendente_confirmacao'
                       ELSE 'conforme' END;
      v_motivo := CASE WHEN v_status='pendente_confirmacao' THEN 'sem_registro_pausa' ELSE NULL END;
    END IF;

    INSERT INTO public.nr36_pausa_apurada (company_id,colaborador_id,cpf,data,tipo,jornada_seg,devido_min,realizado_min,diferenca_min,status,detalhe,apurado_em)
    VALUES (v_reg.company_id,v_reg.colaborador_id,v_reg.cpf,v_reg.data,v_reg.tipo,v_reg.worked_seconds,
      v_devido*v_pausa_min, v_realizado*v_pausa_min, (v_realizado-v_devido)*v_pausa_min, v_status,
      jsonb_build_object('motor','exposicao_ponto','regra',jsonb_build_object('gatilho_min',v_gatilho,'pausa_min',v_pausa_min,'versao','termica_253_v2'),
        'jornada',jsonb_build_object('shift',v_reg.shift,'inicio',to_char(v_jor_ini,'HH24:MI'),'fim',to_char(v_jor_fim,'HH24:MI'),'exposicao_min',round(v_exposicao_min)),
        'pausas',v_detalhe_pausas,'pausas_devidas',v_devido,'pausas_realizadas',v_realizado,'conformes',v_conformes,
        'insuficientes',v_insuf,'excessos',v_excesso,'desvios',v_desvios,'sem_dado_motivo',v_motivo,
        'nao_realizada_estimado',jsonb_build_object('faltantes',GREATEST(v_devido-v_realizado,0),'exposicao_min',round(v_exposicao_min),'base','jornada_menos_pausas','estimado',true)),now())
    ON CONFLICT (company_id,cpf,data,tipo) DO UPDATE SET jornada_seg=EXCLUDED.jornada_seg,devido_min=EXCLUDED.devido_min,realizado_min=EXCLUDED.realizado_min,diferenca_min=EXCLUDED.diferenca_min,status=EXCLUDED.status,detalhe=EXCLUDED.detalhe,colaborador_id=EXCLUDED.colaborador_id,apurado_em=now();
    v_linhas := v_linhas+1;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'linhas',v_linhas);
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- (3) Supervisão: expõe o MOTIVO da pendência para o supervisor distinguir "sem registro de pausa"
--     (dia devido sem nenhuma marcação) de "aguardando confirmação" (pausa aberta/estimada). Mesmo filtro.
-- ─────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_supervisao_pendentes(p_company_id uuid, p_dt_ini date, p_dt_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb; BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
     'data', ap.data, 'cpf', ap.cpf, 'nome', c.nome, 'funcao', c.funcao, 'setor', c.departamento,
     'tipo', ap.tipo,
     'motivo', ap.detalhe->>'sem_dado_motivo',                          -- sem_registro_pausa | pausa_sem_confirmacao
     'sem_registro_pausa', (ap.detalhe->>'sem_dado_motivo' = 'sem_registro_pausa'),
     'shift', ap.detalhe->'jornada'->>'shift',
     'jornada', (SELECT jsonb_build_object(
                   'entrada', to_char(min(mm.datetime AT TIME ZONE 'UTC'),'HH24:MI'),
                   'saida',   to_char(max(mm.datetime AT TIME ZONE 'UTC'),'HH24:MI'))
                 FROM public.ind_ponto_marcacao mm WHERE mm.company_id=ap.company_id AND mm.cpf=ap.cpf AND mm.data=ap.data)
   ) ORDER BY ap.data DESC, c.nome), '[]'::jsonb) INTO v
  FROM public.nr36_pausa_apurada ap
  JOIN public.ind_ponto_colaborador c ON c.id=ap.colaborador_id
  WHERE ap.company_id=p_company_id AND ap.status='pendente_confirmacao' AND ap.data BETWEEN p_dt_ini AND p_dt_fim;
  RETURN jsonb_build_object('ok',true,'pendentes',v);
END $function$;

-- Guardas (item 3 · check-fn-guards): SECURITY DEFINER fechada ao anon; execução só autenticado/serviço.
REVOKE ALL ON FUNCTION public.fn_nr36_dias_sem_dado(uuid,date,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_nr36_apurar(uuid,date,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_nr36_supervisao_pendentes(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_dias_sem_dado(uuid,date,date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_nr36_apurar(uuid,date,date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_nr36_supervisao_pendentes(uuid,date,date) TO authenticated, service_role;
