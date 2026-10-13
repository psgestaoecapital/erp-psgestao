-- ============================================================
-- SST · #74 · ação "aplicar_estimativa" (origem 'estimado') — o documento não fica cheio de lacuna,
-- SEM fingir confirmação humana (decisão do CEO, Opção 2)
-- ============================================================
-- As 229 pausas com fim inferido fraco (inferencia_fraca) não têm batida do ponto para confirmar.
-- Aplicá-las como 'confirmado_manual' fingiria que um humano aceitou — numa via que o colaborador
-- assina. Em vez disso, ganham origem 'estimado': o fim SUGERIDO fica visível no documento, rotulado
-- como estimativa (nunca como registrado nem confirmado). Regras (CEO):
--   1) 'estimado' NÃO entra no veredito legal — o dia com pausa estimada fica 'pendente_confirmacao',
--      nunca 'desvio' nem 'conforme'. Serve para o documento, não para fechar conformidade.
--   2) o Desfazer limpa 'estimado' junto com as demais amarrações.
--   3) o detalhe do dia pendente passa a mostrar o fim (registrado/confirmado_ponto/estimado) — antes
--      só trazia início/classe, e a linha estimada precisa aparecer no relatório de ciência.

-- (1) nova ação na confirmação: aplicar_estimativa → fim_sugerido + origem 'estimado'
CREATE OR REPLACE FUNCTION public.fn_nr36_confirmar_fim_pausa(p_pausa_id uuid, p_acao text, p_fim_manual timestamptz DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_p record; v_fim timestamptz; v_origem text;
BEGIN
  SELECT company_id, fim_sugerido, fim_sugerido_tipo INTO v_p FROM public.ind_ponto_pausa WHERE id=p_pausa_id;
  IF v_p IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;
  IF NOT (v_p.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_acao = 'confirmar_ponto' THEN
    v_fim := v_p.fim_sugerido; v_origem := 'confirmado_ponto';
  ELSIF p_acao = 'confirmar_estimativa' THEN
    v_fim := v_p.fim_sugerido; v_origem := 'confirmado_manual';   -- estimativa ACEITA por um humano = responsabilidade dele
  ELSIF p_acao = 'aplicar_estimativa' THEN
    v_fim := v_p.fim_sugerido; v_origem := 'estimado';            -- estimativa do SISTEMA, sem confirmação (fora do veredito)
  ELSIF p_acao = 'corrigir' THEN
    IF p_fim_manual IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'fim_obrigatorio'); END IF;
    v_fim := p_fim_manual; v_origem := 'confirmado_manual';
  ELSIF p_acao = 'indeterminado' THEN
    v_fim := NULL; v_origem := 'indeterminado';
  ELSE
    RETURN jsonb_build_object('ok', false, 'erro', 'acao_invalida');
  END IF;
  -- RD-30: NÃO toca inicio/fim/duracao/raw da pausa importada. Grava só a amarração (fim_confirmado + fim_origem).
  UPDATE public.ind_ponto_pausa SET fim_confirmado = v_fim, fim_origem = v_origem WHERE id = p_pausa_id;
  RETURN jsonb_build_object('ok', true, 'fim_origem', v_origem, 'fim_confirmado', v_fim);
END $function$;

-- (2) desfazer limpa 'estimado' também
CREATE OR REPLACE FUNCTION public.fn_nr36_desfazer_amarracao_periodo(p_company_id uuid, p_dt_ini date, p_dt_fim date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_n int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE public.ind_ponto_pausa
     SET fim_confirmado = NULL, fim_origem = NULL
   WHERE company_id = p_company_id
     AND data BETWEEN p_dt_ini AND p_dt_fim
     AND fim_origem IN ('confirmado_ponto','confirmado_manual','indeterminado','estimado')
     AND classe_evento IN ('pausa_nao_fechada','pausa_aberta');   -- só as pendentes; nunca as 'registrado'
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'desfeitas', v_n);
END $function$;

-- (3) apuração: 'estimado' é tratado como PENDENTE (fora do veredito) e o detalhe do dia pendente
--     passa a mostrar o fim de cada pausa (registrado / confirmado_ponto / estimado / sem fim)
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
        'nao_realizada_estimado',jsonb_build_object('faltantes',GREATEST(v_devido-v_realizado,0),'exposicao_min',round(v_exposicao_min),'base','jornada_menos_pausas','estimado',true)),now())
    ON CONFLICT (company_id,cpf,data,tipo) DO UPDATE SET jornada_seg=EXCLUDED.jornada_seg,devido_min=EXCLUDED.devido_min,realizado_min=EXCLUDED.realizado_min,diferenca_min=EXCLUDED.diferenca_min,status=EXCLUDED.status,detalhe=EXCLUDED.detalhe,colaborador_id=EXCLUDED.colaborador_id,apurado_em=now();
    v_linhas := v_linhas+1;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'linhas',v_linhas);
END $function$;
