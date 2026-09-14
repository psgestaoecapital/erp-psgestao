-- ============================================================
-- SST ① · NR-36 / Art. 253 — motor SEQUENCIAL + classificação de eventos
-- ============================================================
-- Descoberta (RD-44, corrigida pelo CEO): o dado NÃO está sujo, está MISTURADO.
-- Os 702 registros em ind_ponto_pausa são o export "EVENTOS Integração" do IOPoint =
-- TODOS os eventos de entrada/saída do ambiente. O import rotulou tudo como 'termica_253'.
--   · eventos curtos (~20 min)  = PAUSA (descanso)
--   · eventos longos (horas)    = EXPOSIÇÃO (tempo dentro do ambiente frio)
-- Isso responde a pergunta 3 do SPEC: HÁ registro próprio de exposição → janela='marcacao',
-- e o motor fica MAIS preciso (lê a exposição real em vez de assumir a jornada).
--
-- Defeito do motor antigo (confirmado no código): fn_nr36_apurar classificava 'cumprida'
-- por soma (min_fechado >= devido_min), ignorando gatilho_min/sequência/duração mínima.
-- Efeito: exposições contínuas de 453/473/433 min passavam como conformes.
--
-- Este ① entrega, tudo PARÂMETRO POR EMPRESA (nada chumbado — RD escopo):
--   (a) classe_evento (pausa|exposicao|aberto) por duração vs limite (parâmetro/empresa);
--   (b) o motor sequencial que lê a exposição real e grava desvios[] em detalhe;
--   (c) reprocesso (RD-30: recalcula, nada se perde).
-- Fora deste PR: o fuso da marcação (bug no import do PONTO, não das pausas) e o relatório ② .

-- 1) classe_evento — distingue evento de pausa de evento de exposição. Reversível (recalcula).
ALTER TABLE public.ind_ponto_pausa ADD COLUMN IF NOT EXISTS classe_evento text;

-- 2) Parâmetros por empresa na regra termica_253 (ponto_pausa_perfil não existe → aqui).
--    Merge idempotente: preserva o que já existe, só acrescenta os que faltam.
UPDATE public.nr36_pausa_regra
   SET parametros = parametros
       || jsonb_build_object(
            'limite_evento_pausa_min', COALESCE((parametros->>'limite_evento_pausa_min')::int, 60),
            'pausa_curta_zera',        COALESCE((parametros->>'pausa_curta_zera')::boolean, false),
            'refeicao_conta',          COALESCE((parametros->>'refeicao_conta')::boolean, false),
            'janela_exposicao',        COALESCE(parametros->>'janela_exposicao', 'marcacao')
          ),
       atualizado_em = now()
 WHERE tipo = 'termica_253';

-- 3) Classificação dos eventos por duração vs limite (parâmetro da empresa). Idempotente.
CREATE OR REPLACE FUNCTION public.fn_nr36_classificar_eventos(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_limite int; v_n int;
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  SELECT COALESCE((parametros->>'limite_evento_pausa_min')::int, 60) INTO v_limite
    FROM public.nr36_pausa_regra WHERE company_id=p_company_id AND tipo='termica_253' AND ativo LIMIT 1;
  v_limite := COALESCE(v_limite, 60);
  UPDATE public.ind_ponto_pausa
     SET classe_evento = CASE
       WHEN fim IS NULL THEN 'aberto'                                  -- em aberto: não classifica por duração
       WHEN round(duracao_seg/60.0) >= v_limite THEN 'exposicao'
       ELSE 'pausa' END
   WHERE company_id = p_company_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'classificados', v_n, 'limite_min', v_limite);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_nr36_classificar_eventos(uuid) TO authenticated;

-- 4) O MOTOR SEQUENCIAL. termica_253 = lê a exposição real (eventos), aplica gatilho_min/pausa_min,
--    grava desvios[]. psicofisiologica mantém a lógica de faixas (soma por jornada). Vocabulário
--    de status novo (SPEC 2.2): conforme · desvio · aguardando_realizado · sem_dado — nunca
--    'cumprida' quando não há como saber (RD-51).
CREATE OR REPLACE FUNCTION public.fn_nr36_apurar(p_company_id uuid, p_dt_ini date, p_dt_fim date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_linhas int := 0;
  v_reg record; v_ev record;
  v_param jsonb; v_gatilho int; v_pausa_min int; v_curta_zera boolean;
  v_desvios jsonb; v_devidas int; v_realizadas int; v_conformes int; v_expo_max int;
  v_status text; v_tem_aberto boolean; v_tem_fechado boolean;
  v_devido int; v_realizado int; v_shift text;
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  PERFORM public.fn_nr36_classificar_eventos(p_company_id);  -- garante classe antes de apurar

  FOR v_reg IN
    SELECT e.company_id, e.tipo, c.id AS colaborador_id, d.cpf, d.data, d.worked_seconds, d.shift, r.parametros
    FROM public.nr36_funcionario_elegivel e
    JOIN public.ind_ponto_colaborador c ON c.id = e.colaborador_id
    JOIN public.nr36_pausa_regra r ON r.company_id = e.company_id AND r.tipo = e.tipo AND r.ativo
    JOIN public.ind_ponto_dia d ON d.company_id = e.company_id AND d.cpf = c.cpf
         AND d.data BETWEEN p_dt_ini AND p_dt_fim AND COALESCE(d.worked_seconds,0) > 0
    WHERE e.company_id = p_company_id AND e.ativo
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
        IF v_ev.fim IS NULL THEN
          v_tem_aberto := true; CONTINUE;                    -- em aberto não é descumprimento
        END IF;
        v_tem_fechado := true;

        IF v_ev.classe_evento = 'exposicao' THEN
          -- exposição contínua: a cada gatilho_min dentro do ambiente é devida 1 pausa
          IF v_ev.dur_min > v_gatilho THEN
            v_devidas := v_devidas + floor(v_ev.dur_min::numeric / GREATEST(v_gatilho,1))::int;
            v_expo_max := GREATEST(v_expo_max, v_ev.dur_min);
            v_desvios := v_desvios || jsonb_build_object(
              'tipo','excedeu_limite','de',to_char(v_ev.inicio,'HH24:MI'),'ate',to_char(v_ev.fim,'HH24:MI'),
              'minutos', v_ev.dur_min, 'excedeu', v_ev.dur_min - v_gatilho);
          END IF;
        ELSE   -- pausa
          IF v_ev.dur_min < v_pausa_min THEN
            v_desvios := v_desvios || jsonb_build_object(
              'tipo','pausa_insuficiente','inicio',to_char(v_ev.inicio,'HH24:MI'),
              'duracao_min', v_ev.dur_min, 'minimo', v_pausa_min);
            -- pausa curta não conta como realizada; só zera a exposição se o parâmetro permitir
          ELSE
            v_realizadas := v_realizadas + 1; v_conformes := v_conformes + 1;
          END IF;
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

      INSERT INTO public.nr36_pausa_apurada
        (company_id, colaborador_id, cpf, data, tipo, jornada_seg, devido_min, realizado_min, diferenca_min, status, detalhe, apurado_em)
      VALUES (v_reg.company_id, v_reg.colaborador_id, v_reg.cpf, v_reg.data, v_reg.tipo, v_reg.worked_seconds,
        v_devidas * v_pausa_min, v_realizadas * v_pausa_min, (v_realizadas - v_devidas) * v_pausa_min, v_status,
        jsonb_build_object(
          'motor','sequencial',
          'jornada', jsonb_build_object('shift', v_reg.shift),
          'regra', jsonb_build_object('gatilho_min', v_gatilho, 'pausa_min', v_pausa_min,
                    'versao','termica_253','janela_exposicao', COALESCE(v_param->>'janela_exposicao','marcacao'),
                    'pausa_curta_zera', v_curta_zera),
          'desvios', v_desvios, 'pausas_devidas', v_devidas, 'pausas_realizadas', v_realizadas,
          'conformes', v_conformes, 'exposicao_maxima_min', v_expo_max, 'tem_aberto', v_tem_aberto),
        now())
      ON CONFLICT (company_id, cpf, data, tipo) DO UPDATE SET
        jornada_seg=EXCLUDED.jornada_seg, devido_min=EXCLUDED.devido_min, realizado_min=EXCLUDED.realizado_min,
        diferenca_min=EXCLUDED.diferenca_min, status=EXCLUDED.status, detalhe=EXCLUDED.detalhe,
        colaborador_id=EXCLUDED.colaborador_id, apurado_em=now();
      v_linhas := v_linhas + 1;

    ELSE
      -- psicofisiologica (NR-36 36.13.2): devido por faixa de jornada; realizado = soma das PAUSAS.
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
      INSERT INTO public.nr36_pausa_apurada
        (company_id, colaborador_id, cpf, data, tipo, jornada_seg, devido_min, realizado_min, diferenca_min, status, detalhe, apurado_em)
      VALUES (v_reg.company_id, v_reg.colaborador_id, v_reg.cpf, v_reg.data, v_reg.tipo, v_reg.worked_seconds,
        v_devido, COALESCE(v_realizado,0), COALESCE(v_realizado,0) - v_devido, v_status,
        jsonb_build_object('motor','faixas','devido_min',v_devido,'realizado_min',COALESCE(v_realizado,0),
          'jornada', jsonb_build_object('shift', v_reg.shift), 'tem_aberto', COALESCE(v_tem_aberto,false)),
        now())
      ON CONFLICT (company_id, cpf, data, tipo) DO UPDATE SET
        jornada_seg=EXCLUDED.jornada_seg, devido_min=EXCLUDED.devido_min, realizado_min=EXCLUDED.realizado_min,
        diferenca_min=EXCLUDED.diferenca_min, status=EXCLUDED.status, detalhe=EXCLUDED.detalhe,
        colaborador_id=EXCLUDED.colaborador_id, apurado_em=now();
      v_linhas := v_linhas + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'linhas', v_linhas);
END $fn$;

-- 5) Classificação inicial no deploy — UPDATE PURO (sem fn/assert: o runner do db push não é
--    admin e auth.uid() é nulo; chamar a fn aqui daria 'sem_acesso' e quebraria o pipeline — RD-52).
--    A reapuração (fn_nr36_apurar, que assere acesso) roda APÓS o deploy, impersonando admin.
UPDATE public.ind_ponto_pausa p
   SET classe_evento = CASE
     WHEN p.fim IS NULL THEN 'aberto'
     WHEN round(p.duracao_seg/60.0) >= COALESCE((r.parametros->>'limite_evento_pausa_min')::int, 60) THEN 'exposicao'
     ELSE 'pausa' END
  FROM public.nr36_pausa_regra r
 WHERE r.company_id = p.company_id AND r.tipo = 'termica_253' AND r.ativo;
-- eventos de empresas sem regra termica_253: default 60 (parâmetro; a regra da empresa sobrepõe depois)
UPDATE public.ind_ponto_pausa
   SET classe_evento = CASE WHEN fim IS NULL THEN 'aberto'
     WHEN round(duracao_seg/60.0) >= 60 THEN 'exposicao' ELSE 'pausa' END
 WHERE classe_evento IS NULL;

-- 6) RPCs de leitura alinhadas ao vocabulário novo (conforme·desvio·aguardando_realizado·sem_dado).
--    O resumo deixa de somar 'nao_cumprida/parcial' e passa a contar desvio/conforme/sem_dado.
CREATE OR REPLACE FUNCTION public.fn_nr36_apuracao_listar(p_company_id uuid, p_dt_ini date, p_dt_fim date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v jsonb; v_tem boolean; BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  SELECT EXISTS (SELECT 1 FROM public.ind_ponto_pausa WHERE company_id=p_company_id) INTO v_tem;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'colaborador_id',a.colaborador_id,'cpf',a.cpf,'nome',c.nome,'funcao',c.funcao,'tipo',a.tipo,
      'dias',a.dias,'devido_min',a.devido_tot,'realizado_min',a.realizado_tot,
      'dias_desvio',a.desvio,'dias_conforme',a.conforme,'dias_aguardando',a.aguardando,'dias_sem_dado',a.sem_dado,
      'status', CASE WHEN a.desvio>0 THEN 'desvio'
                     WHEN a.aguardando=a.dias THEN 'aguardando_realizado'
                     WHEN a.sem_dado=a.dias THEN 'sem_dado'
                     WHEN a.conforme>0 THEN 'conforme' ELSE 'sem_dado' END
    ) ORDER BY c.nome, a.tipo), '[]'::jsonb) INTO v FROM (
    SELECT ap.company_id, ap.colaborador_id, ap.cpf, ap.tipo, count(*) AS dias,
           sum(ap.devido_min) AS devido_tot, sum(ap.realizado_min) AS realizado_tot,
           count(*) FILTER (WHERE ap.status='desvio')                AS desvio,
           count(*) FILTER (WHERE ap.status='conforme')              AS conforme,
           count(*) FILTER (WHERE ap.status='aguardando_realizado')  AS aguardando,
           count(*) FILTER (WHERE ap.status='sem_dado')              AS sem_dado
    FROM public.nr36_pausa_apurada ap
    WHERE ap.company_id=p_company_id AND ap.data BETWEEN p_dt_ini AND p_dt_fim
    GROUP BY ap.company_id, ap.colaborador_id, ap.cpf, ap.tipo
  ) a JOIN public.ind_ponto_colaborador c ON c.id=a.colaborador_id;
  RETURN jsonb_build_object('ok', true, 'tem_realizado', v_tem, 'resumo', v);
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_nr36_alertas(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_n int := 0; BEGIN
  IF p_company_id IS NOT NULL THEN PERFORM public.fn_nr36_assert(p_company_id); END IF;
  INSERT INTO public.erp_alerta_proativo (company_id, tipo, severidade, titulo, mensagem, contexto, link_acao)
  SELECT g.company_id, 'nr36_pausa', 'critica',
    'Desvios de pausa/exposição ' || g.tipo || ': ' || c.nome || ' (' || g.dias || ' dia(s))',
    c.nome || ' tem ' || g.dias || ' dia(s) com desvio de pausa/exposição ' || g.tipo || ' no período recente. Risco de passivo (Art.253/NR-36).',
    jsonb_build_object('cpf', g.cpf, 'tipo', g.tipo, 'dias', g.dias),
    '/dashboard/compliance/pausas-tecnicas'
  FROM (
    SELECT ap.company_id, ap.cpf, ap.tipo, count(*) AS dias
    FROM public.nr36_pausa_apurada ap
    WHERE (p_company_id IS NULL OR ap.company_id = p_company_id)
      AND ap.status = 'desvio' AND ap.data >= CURRENT_DATE - 30
    GROUP BY ap.company_id, ap.cpf, ap.tipo
  ) g JOIN public.ind_ponto_colaborador c ON c.company_id = g.company_id AND c.cpf = g.cpf
  WHERE NOT EXISTS (SELECT 1 FROM public.erp_alerta_proativo a WHERE a.company_id = g.company_id AND a.tipo='nr36_pausa'
      AND a.contexto->>'cpf' = g.cpf AND a.contexto->>'tipo' = g.tipo
      AND COALESCE(a.resolvido,false)=false AND COALESCE(a.dispensado,false)=false);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'alertas_criados', v_n);
END $fn$;
