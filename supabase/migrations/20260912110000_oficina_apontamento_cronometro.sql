-- ============================================================
-- Oficina Onda 1 · 3.1 — o tempo do apontamento é SEMPRE o do relógio; digitar vira ajuste EXPLÍCITO
-- ============================================================
-- Defeito (provado): fn_oficina_apontamento_concluir fazia v_real := coalesce(p_tempo_real_h, cronômetro)
-- — o valor DIGITADO sobrepunha o relógio. Resultado: 37 de 38 apontamentos "concluídos" em < 1 min de
-- relógio mas com tempo_real_h de 1–3 h digitado. Não era medição, era digitação com cronômetro decorativo.
--
-- Fix cirúrgico (RD-60): o cronômetro vira a fonte do tempo, gravado SEMPRE em coluna própria
-- (tempo_cronometro_h). p_tempo_real_h NÃO é removido (o mecânico esquece de fechar e alguém corrige),
-- mas passa a ser AJUSTE MANUAL explícito: só vale quando difere do relógio, e fica MARCADO
-- (ajustado_manual / ajustado_por / ajustado_em). A tela (outro PR) só oferece ajuste DEPOIS de concluir.

ALTER TABLE public.erp_os_apontamento
  ADD COLUMN IF NOT EXISTS tempo_cronometro_h numeric,
  ADD COLUMN IF NOT EXISTS ajustado_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ajustado_por uuid,
  ADD COLUMN IF NOT EXISTS ajustado_em timestamptz;

-- RD-61 · backfill de MARCAÇÃO (não muda status nem tempo_real_h): grava o cronômetro real dos concluídos
-- e MARCA como ajuste manual os que divergem do relógio (> ~1 min) — os 37 históricos digitados. Assim
-- a eficiência sabe distinguir medição de digitação. Nenhuma linha muda de status; nenhuma é apagada.
UPDATE public.erp_os_apontamento
SET tempo_cronometro_h = round(EXTRACT(EPOCH FROM (finalizado_em - iniciado_em))/3600.0, 2),
    ajustado_manual = (tempo_real_h IS NOT NULL
      AND abs(COALESCE(tempo_real_h,0) - round(EXTRACT(EPOCH FROM (finalizado_em - iniciado_em))/3600.0, 2)) > 0.02)
WHERE finalizado_em IS NOT NULL AND iniciado_em IS NOT NULL AND tempo_cronometro_h IS NULL;

CREATE OR REPLACE FUNCTION public.fn_oficina_apontamento_concluir(p_company_id uuid, p_apontamento_id uuid, p_tempo_real_h numeric DEFAULT NULL::numeric, p_mecanico_nome text DEFAULT NULL::text, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_a record; v_cron numeric; v_ajuste boolean; v_real numeric; v_exec uuid; v_modelo text;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  SELECT * INTO v_a FROM erp_os_apontamento
    WHERE id = p_apontamento_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'apontamento nao encontrado'); END IF;

  -- o tempo é SEMPRE o do relógio (fonte única · não mais o digitado)
  v_cron := CASE WHEN v_a.iniciado_em IS NOT NULL
                 THEN round(EXTRACT(EPOCH FROM (now() - v_a.iniciado_em))/3600.0, 2)
                 ELSE v_a.tempo_real_h END;
  -- ajuste manual EXPLÍCITO: só quando informado E diferente do relógio (correção de quem esqueceu de fechar)
  v_ajuste := (p_tempo_real_h IS NOT NULL AND (v_cron IS NULL OR abs(p_tempo_real_h - v_cron) > 0.001));
  v_real := CASE WHEN v_ajuste THEN p_tempo_real_h ELSE v_cron END;

  UPDATE erp_os_apontamento SET
    tempo_real_h = v_real,
    tempo_cronometro_h = v_cron,                        -- relógio gravado SEMPRE
    ajustado_manual = COALESCE(v_ajuste, false),
    ajustado_por = CASE WHEN v_ajuste THEN auth.uid() ELSE NULL END,
    ajustado_em  = CASE WHEN v_ajuste THEN now() ELSE NULL END,
    finalizado_em = now(),
    status = 'concluido',
    mecanico_nome = coalesce(nullif(btrim(coalesce(p_mecanico_nome,'')),''), mecanico_nome),
    observacao = coalesce(nullif(btrim(coalesce(p_observacao,'')),''), observacao)
  WHERE id = p_apontamento_id AND company_id = p_company_id;

  -- alimenta o tempário com o tempo efetivo (só quando ligado ao catálogo · servico_id)
  IF v_a.servico_id IS NOT NULL AND v_a.execucao_id IS NULL THEN
    SELECT (marca || ' ' || coalesce(modelo,''))::text INTO v_modelo FROM erp_os WHERE id = v_a.os_id;
    INSERT INTO erp_oficina_servico_execucao (company_id, servico_id, os_id, mecanico_id,
      tempo_previsto_h, tempo_real_h, veiculo_modelo)
    VALUES (p_company_id, v_a.servico_id, v_a.os_id, v_a.mecanico_id,
      v_a.tempo_estimado_h, v_real, nullif(btrim(coalesce(v_modelo,'')),''))
    RETURNING id INTO v_exec;
    UPDATE erp_os_apontamento SET execucao_id = v_exec WHERE id = p_apontamento_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'apontamento_id', p_apontamento_id,
    'tempo_real_h', v_real, 'tempo_cronometro_h', v_cron, 'ajustado_manual', COALESCE(v_ajuste,false),
    'execucao_gravada', (v_exec IS NOT NULL));
END $function$;
