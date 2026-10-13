-- ============================================================
-- SST ⑤ · reconciliação ganha o bloco SINALIZADO (os 54 não podem sumir da vista — CEO)
-- ============================================================
-- A reapuração ④ tirou a não-realizada do veredito legal (é estimativa, RD-38). Mas o CEO exige
-- que os dias com jornada e ZERO pausa térmica registrada fiquem VISÍVEIS e rotulados — é o próximo
-- gargalo (pausa não concedida OU falha total de registro; a responsável verifica no cartão).
-- Esta versão acrescenta 'sinalizado' ao retorno, SEM tocar no veredito (nunca somado ao desvio):
--   • dias_jornada_zero_pausa — dias conforme com jornada e nenhuma pausa registrada (o grave);
--   • dias_com_estimativa      — dias conforme onde a exposição estimava pausa que não foi feita;
--   • pausas_nao_realizadas_estimadas — soma dessas pausas (ESTIMATIVA, fora do número legal).
-- Genérica por tenant. Read-only (STABLE). A UI mostra veredito × sinalizado lado a lado.
CREATE OR REPLACE FUNCTION public.fn_nr36_reconciliacao(p_company_id uuid, p_dt_ini date, p_dt_fim date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_classes jsonb; v_dias_desvio int; v_dias_pendente int; v_dias_conforme int; v_dias_sem_dado int;
        v_zero_pausa int; v_com_estimativa int; v_estimadas int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT jsonb_object_agg(classe_evento, n) INTO v_classes
    FROM (SELECT classe_evento, count(*) n FROM public.ind_ponto_pausa
          WHERE company_id=p_company_id AND data BETWEEN p_dt_ini AND p_dt_fim GROUP BY 1) x;
  SELECT count(*) FILTER (WHERE status='desvio'), count(*) FILTER (WHERE status='pendente_confirmacao'),
         count(*) FILTER (WHERE status='conforme'), count(*) FILTER (WHERE status='sem_dado'),
         count(*) FILTER (WHERE status='conforme' AND COALESCE(jsonb_array_length(detalhe->'pausas'),0)=0),
         count(*) FILTER (WHERE status='conforme' AND COALESCE((detalhe->'nao_realizada_estimado'->>'faltantes')::int,0) > 0),
         COALESCE(sum((detalhe->'nao_realizada_estimado'->>'faltantes')::int) FILTER (WHERE status='conforme'),0)
    INTO v_dias_desvio, v_dias_pendente, v_dias_conforme, v_dias_sem_dado, v_zero_pausa, v_com_estimativa, v_estimadas
    FROM public.nr36_pausa_apurada
   WHERE company_id=p_company_id AND tipo='termica_253' AND data BETWEEN p_dt_ini AND p_dt_fim;
  RETURN jsonb_build_object('ok', true,
    'eventos_por_classe', COALESCE(v_classes,'{}'::jsonb),
    'leitura', jsonb_build_object(
      'esquecimento_tratado', COALESCE((v_classes->>'pausa_nao_fechada')::int,0) + COALESCE((v_classes->>'pausa_aberta')::int,0),
      'excesso_gestao_nao_infracao', COALESCE((v_classes->>'pausa_excesso')::int,0),
      'insuficiente_legal', COALESCE((v_classes->>'pausa_insuficiente')::int,0)),
    'dias', jsonb_build_object('desvio', v_dias_desvio, 'pendente_confirmacao', v_dias_pendente, 'conforme', v_dias_conforme, 'sem_dado', v_dias_sem_dado),
    -- fora do veredito legal (RD-38 · estimado ≠ registrado) — a UI mostra à parte, nunca somado
    'sinalizado', jsonb_build_object(
      'dias_jornada_zero_pausa', v_zero_pausa,
      'dias_com_estimativa', v_com_estimativa,
      'pausas_nao_realizadas_estimadas', v_estimadas,
      'rotulo', v_zero_pausa || ' dia(s) com jornada e nenhuma pausa registrada — pode ser pausa não concedida OU falha total de registro. Precisa de verificação contra o cartão.'));
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_nr36_reconciliacao(uuid, date, date) TO authenticated;
