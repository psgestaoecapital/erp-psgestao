-- #2119 (Frioeste / NR-36 · Karol) — o Painel de pausas ficava preso em "aguardando confirmação"
-- em dias que NÃO têm o que confirmar na aba Conferência, então a responsável nunca tira o dia de
-- "aguardando". Provado no dado (set/2026, Frioeste): 69 dias "pendente_confirmacao" com motivo
-- 'pausas_faltantes' em que TODAS as pausas realizadas eram conformes e FECHADAS (nenhuma em aberto).
--
-- Causa: o motor térmica_253 marcava 'pendente_confirmacao' quando a jornada expôs o colaborador a
-- MAIS pausas do que as realizadas (devido > realizado, com almoço descontado da exposição — #587),
-- mesmo sem nenhuma pausa abaixo do mínimo e sem nenhuma pausa sem fim. Como a Conferência só atua em
-- pausa SEM fim confiável, não havia nada a conferir e o dia ficava "aguardando" para sempre.
--
-- Decisão do CEO (31/10, via Eng. Chefe) — SUPERA a parte de #587 (CEO 04/10) que mandava esse dia
-- para 'pendente_confirmacao': um dia em que TODAS as pausas realizadas são conformes e a única falta
-- é uma pausa DEVIDA-por-exposição NÃO realizada (ESTIMATIVA) é 'conforme' no veredito legal; a pausa
-- estimada-faltante continua SINALIZADA À PARTE — "estimado ≠ registrado, nunca somado ao desvio".
-- O sinal já é lido por fn_nr36_reconciliacao em detalhe->'nao_realizada_estimado' das linhas
-- status='conforme' (dias_com_estimativa / pausas_nao_realizadas_estimadas). Esta migration ALINHA o
-- motor à função de reconciliação, que já esperava essas linhas em 'conforme'.
--
-- O que NÃO muda (intocado):
--   (a) pausa abaixo do mínimo (v_insuf > 0) segue 'desvio';
--   (b) pausa com fim não confiável (aberta / 'indeterminado' / 'estimado') segue
--       'pendente_confirmacao' — ESSA sim é acionável na aba Conferência;
--   (c) dia que exigia pausa (devido > 0) e teve ZERO pausa registrada segue 'pendente_confirmacao'
--       com motivo 'sem_registro_pausa' (verificação contra o cartão — não é mera estimativa).
--
-- Mudança cirúrgica: remove apenas a linha do CASE que levava 'pausas_faltantes' a
-- 'pendente_confirmacao' (cai no ELSE 'conforme'); o detalhe->'nao_realizada_estimado' já é gravado,
-- preservando o sinal. SECURITY DEFINER mantido; sem anon (service_role, igual ao estado atual).

-- ci-sem-guarda: fn_nr36_apurar_nucleo — escape consciente do check:fn-guards (regra 4). O núcleo roda como
-- SERVIÇO: é REVOKE de PUBLIC/anon/authenticated e GRANT só a service_role (ver abaixo), e só é chamado por
-- (a) fn_nr36_reapurar_servico — inclusive dentro desta migration, SEM usuário logado — e (b) pelas RPCs do
-- Painel (fn_nr36_apurar/_apuracao_listar), que conferem a empresa via fn_nr36_assert(auth.uid()) ANTES de
-- chamar o núcleo. Pôr fn__guarda_empresa aqui EXIGE auth.uid() e QUEBRARIA a reapuração (migration/serviço) e
-- o próprio Painel. A conferência de empresa fica na borda (RPCs + GRANT), não no núcleo de serviço.
CREATE OR REPLACE FUNCTION public.fn_nr36_apurar_nucleo(p_company_id uuid, p_dt_ini date, p_dt_fim date, p_cpf text DEFAULT NULL::text)
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
  v_detalhe_pausas jsonb; v_almoco_min numeric:=0; v_almoco_on boolean:=false; v_pts timestamp[]; v_i int;
BEGIN
  PERFORM public.fn_nr36_classificar_eventos_nucleo(p_company_id);
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
      v_desvios := '[]'::jsonb; v_devido:=0; v_realizado:=0; v_conformes:=0; v_insuf:=0; v_excesso:=0; v_exposicao_min:=0; v_detalhe_pausas:='[]'::jsonb;
    ELSIF COALESCE(v_pendente,false) THEN
      v_status := 'pendente_confirmacao'; v_motivo := 'pausa_sem_confirmacao';
      v_desvios := '[]'::jsonb; v_devido:=0; v_realizado:=0; v_conformes:=0; v_insuf:=0; v_excesso:=0; v_exposicao_min:=0;
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
      v_almoco_on := COALESCE((v_param->>'almoco_interrompe_exposicao')::boolean, false);
      v_almoco_min := 0;
      IF v_almoco_on THEN
        SELECT array_agg((pt->>'datetime')::timestamp ORDER BY (pt->>'datetime')::timestamp) INTO v_pts
          FROM public.ind_ponto_dia d3, jsonb_array_elements(d3.raw->'points') pt
         WHERE d3.company_id=v_reg.company_id AND d3.cpf=v_reg.cpf AND d3.data=v_reg.data;
        IF cardinality(v_pts) >= 4 AND cardinality(v_pts) % 2 = 0 THEN
          FOR v_i IN 1..(cardinality(v_pts)/2 - 1) LOOP
            v_almoco_min := v_almoco_min + EXTRACT(EPOCH FROM (v_pts[2*v_i+1] - v_pts[2*v_i]))/60;
          END LOOP;
        END IF;
      END IF;
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
      v_exposicao_min := GREATEST(v_jornada_min - COALESCE(v_pausas_min,0) - v_almoco_min, 0);
      v_devido := floor(v_exposicao_min / GREATEST(v_gatilho,1))::int;
      v_desvios := '[]'::jsonb;
      IF v_insuf > 0 THEN v_desvios := v_desvios || jsonb_build_object('tipo','pausa_insuficiente','quantidade',v_insuf); END IF;
      -- #86/#92: dia que EXIGIA pausa (devido>0) e não teve NENHUMA marcação de pausa não é 'conforme'
      -- (RD-51) nem 'desvio' (RD-38 — exposição é estimativa, fora do veredito). Vira pendência a confirmar
      -- (verificação contra o cartão — 'sem_registro_pausa').
      -- #2119 (CEO 31/10, supera #587 04/10): dia COM pausas, todas conformes e fechadas, mas realizadas <
      -- devidas (falta ESTIMADA por exposição) NÃO é mais 'pendente_confirmacao' — não há o que conferir.
      -- Vira 'conforme'; a falta estimada segue SINALIZADA à parte em detalhe->'nao_realizada_estimado'
      -- (lida por fn_nr36_reconciliacao). Jornada curta (devido=0) segue 'conforme' como antes.
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
        'nao_realizada_estimado',jsonb_build_object('faltantes',GREATEST(v_devido-v_realizado,0),'exposicao_min',round(v_exposicao_min),'base','jornada_menos_pausas','estimado',true)) || CASE WHEN v_almoco_min > 0 THEN jsonb_build_object('almoco_min', round(v_almoco_min)) ELSE '{}'::jsonb END,now())
    ON CONFLICT (company_id,cpf,data,tipo) DO UPDATE SET jornada_seg=EXCLUDED.jornada_seg,devido_min=EXCLUDED.devido_min,realizado_min=EXCLUDED.realizado_min,diferenca_min=EXCLUDED.diferenca_min,status=EXCLUDED.status,detalhe=EXCLUDED.detalhe,colaborador_id=EXCLUDED.colaborador_id,apurado_em=now();
    v_linhas := v_linhas+1;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'linhas',v_linhas);
END $function$;

REVOKE ALL ON FUNCTION public.fn_nr36_apurar_nucleo(uuid,date,date,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nr36_apurar_nucleo(uuid,date,date,text) TO service_role;

-- Reapuração dirigida (CEO 31/10) — a mudança da regra NÃO altera linhas já apuradas; por isso a PR
-- reapura a FRIOESTE (empresa do chamado #2119) nos meses JÁ importados (ago/set/out 2026), COM BACKUP
-- (fn_nr36_reapurar_servico grava em nr36_pausa_apurada_backup antes de reescrever), senão o relatório
-- entregue ao Ministério continuaria mostrando "aguardando" mesmo com a regra corrigida.
-- Provado no dado (probe BEGIN/ROLLBACK, set/2026): 78 pendentes → 9 (os 69 'pausas_faltantes' viram
-- 'conforme'; ficam só os 5 'sem_registro_pausa' + 4 'pausa_sem_confirmacao', genuinamente acionáveis);
-- 69 conformes passam a sinalizar 104 pausas estimadas na Reconciliação; 71 desvios reais intactos.
-- DEFENSIVO: a reapuração roda em bloco próprio com captura de exceção e RAISE WARNING — se algo falhar
-- no deploy, a CORREÇÃO DA FUNÇÃO (o essencial) continua aplicada e a responsável reapura pelo botão
-- "Reapurar período" do Painel (que agora usa a regra correta). Escopo fechado nesta empresa.
DO $reap$
DECLARE v_empresa constant uuid := '975365cc-9e5a-4251-9022-68c6bfde10d8'; -- FRIOESTE
        v_mes record; v_rel jsonb;
BEGIN
  -- banco de testes das vagas NÃO tem as empresas reais (só catálogos): se a FRIOESTE não existe, pula
  -- (a correção da função já está aplicada; a prova @pos-migration roda em produção, onde a empresa existe).
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_empresa) THEN RETURN; END IF;
  SET LOCAL statement_timeout = '120s';
  SET LOCAL lock_timeout = '10s';
  FOR v_mes IN SELECT * FROM (VALUES
      (DATE '2026-08-01', DATE '2026-08-31'),
      (DATE '2026-09-01', DATE '2026-09-30'),
      (DATE '2026-10-01', DATE '2026-10-31')) m(ini, fim)
  LOOP
    BEGIN
      v_rel := public.fn_nr36_reapurar_servico(v_empresa, v_mes.ini, v_mes.fim);
      RAISE NOTICE '#2119 reapuração FRIOESTE % .. %: backup=% dias_mudaram=%',
        v_mes.ini, v_mes.fim, v_rel->>'linhas_backup', v_rel->>'dias_mudaram';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '#2119 reapuração FRIOESTE % .. % FALHOU (%); a função já está corrigida — reapurar pelo Painel.',
        v_mes.ini, v_mes.fim, SQLERRM;
    END;
  END LOOP;
END $reap$;
