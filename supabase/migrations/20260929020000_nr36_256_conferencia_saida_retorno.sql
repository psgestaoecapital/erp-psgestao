-- Frioeste #256 (SST · 28/09) · Conferência de pausas: "nem sempre é o horário que o colaborador sai para a pausa;
-- por vezes eles não registram a saída e registram apenas o retorno. Preciso poder identificar se o horário é entrada
-- ou saída e ajustar."
--
-- Causa (provada no dado, 29/09): o relatório do IO Point entrega a pausa em PARES (início, fim). Quando falta uma
-- batida, o par desliza e todos os pares seguintes do dia ficam deslocados. Ex. (22/09): gravado 13:30–15:02,
-- 15:32–18:42, 19:05–20:17, 20:39–aberta; as pausas reais são os intervalos 15:02→15:32, 18:42→19:05, 20:17→20:39, e
-- 13:30 é um retorno cuja saída não foi batida. As 157 pendências da Conferência (16–25/09, 8 pessoas) têm esse
-- formato. É o mesmo mecanismo do #107 (Vinicius), que foi reparado por migration; aqui a responsável faz pela tela.
--
-- O que muda:
--   fn_nr36_marcas_dia(company, cpf, data)            → as marcações do dia como o arquivo trouxe (início=Saída, fim=Retorno)
--   fn_nr36_reler_dia(company, cpf, data, marcas)     → a responsável diz o que cada horário é (saida | retorno | ignorar)
--        e pode acrescentar o horário que faltou; o sistema refaz os pares do dia. Regra (igual a src/lib/ponto/pausasMarcas.ts):
--        Saída abre, o próximo Retorno fecha; Saída seguida de Saída = pausa sem retorno (pausa_aberta, volta à Conferência);
--        Retorno sem Saída = pausa sem hora de saída: a linha guarda o horário do retorno, sem fim, com
--        inicio_origem='sem_saida' (a saída nunca é inventada, RD-38) e continua pendente na Conferência.
--        As linhas antigas vão INTEIRAS para nr36_pausa_historico (RD-30), no lote da releitura; o dia é reapurado.
--   fn_nr36_reler_dia_desfazer(company, cpf, data)    → volta o dia ao que era antes da última releitura (do histórico).
--   fn_nr36_confirmar_fim_pausa                       → recusa confirmar/corrigir o FIM de uma pausa sem hora de saída
--        (sem início não há duração; o caminho é informar a saída no editor de marcações, ou "Não sei").
--   fn_nr36_pausas_pendentes_listar                   → devolve também sem_saida (a tela mostra "retorno às HH:MM · saída
--        não registrada" e só oferece informar a saída ou "Não sei").
--   ind_ponto_pausa.inicio_origem                     → NULL = veio do arquivo; 'manual' = saída digitada pela responsável;
--        'sem_saida' = o horário é um RETORNO cuja saída não foi batida. O fim digitado segue em fim_origem='confirmado_manual'.

ALTER TABLE public.ind_ponto_pausa ADD COLUMN IF NOT EXISTS inicio_origem text;
ALTER TABLE public.nr36_pausa_historico ADD COLUMN IF NOT EXISTS inicio_origem text;
ALTER TABLE public.nr36_pausa_historico ADD COLUMN IF NOT EXISTS restaurado_em timestamptz;
COMMENT ON COLUMN public.ind_ponto_pausa.inicio_origem IS '#256: NULL = saída veio do arquivo; manual = digitada na Conferência; sem_saida = o horário é um retorno sem saída batida';
COMMENT ON COLUMN public.nr36_pausa_historico.restaurado_em IS '#256: quando a linha voltou para ind_ponto_pausa (desfazer releitura)';

-- ── marcações do dia ──────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_marcas_dia(p_company_id uuid, p_cpf text, p_data date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  RETURN jsonb_build_object(
    'ok', true,
    'colaborador', (SELECT c.nome FROM public.ind_ponto_colaborador c WHERE c.company_id = p_company_id AND c.cpf = p_cpf LIMIT 1),
    'linhas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'pausa_id', p.id,
        'inicio_local', to_char(p.inicio AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
        'fim_local', to_char(COALESCE(p.fim_confirmado, p.fim) AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
        'inicio_manual', COALESCE(p.inicio_origem = 'manual', false),
        'sem_saida', COALESCE(p.inicio_origem = 'sem_saida', false),
        'fim_manual', COALESCE(p.fim_origem = 'confirmado_manual', false),
        'classe', p.classe_evento,
        'minutos', round(EXTRACT(EPOCH FROM (COALESCE(p.fim_confirmado, p.fim) - p.inicio)) / 60)
      ) ORDER BY p.inicio NULLS FIRST, p.fim)
      FROM public.ind_ponto_pausa p WHERE p.company_id = p_company_id AND p.cpf = p_cpf AND p.data = p_data), '[]'::jsonb),
    'pode_desfazer', EXISTS (SELECT 1 FROM public.ind_ponto_pausa p WHERE p.company_id = p_company_id AND p.cpf = p_cpf
                               AND p.data = p_data AND p.raw->>'reler' = '#256'));
END $function$;
REVOKE ALL ON FUNCTION public.fn_nr36_marcas_dia(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_marcas_dia(uuid, text, date) TO authenticated, service_role;

-- ── releitura do dia ──────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_reler_dia(p_company_id uuid, p_cpf text, p_data date, p_marcas jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lote uuid := gen_random_uuid();
  v_base record; v_m record; v_n_antes int; v_arq int; v_novas int := 0;
  v_aberta timestamptz; v_aberta_manual boolean; v_ts timestamptz;
  v_usadas int;
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  IF p_marcas IS NULL OR jsonb_typeof(p_marcas) <> 'array' OR jsonb_array_length(p_marcas) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_marcas', 'mensagem', 'Informe as marcações do dia.');
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_marcas) m
              WHERE COALESCE(m->>'hora','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                 OR COALESCE(m->>'papel','') NOT IN ('saida','retorno','ignorar')) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'marca_invalida', 'mensagem', 'Horário inválido (use HH:MM) ou tipo de marcação desconhecido.');
  END IF;
  IF (SELECT count(*) <> count(DISTINCT m->>'hora') FROM jsonb_array_elements(p_marcas) m) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'hora_repetida', 'mensagem', 'Há horário repetido. Cada marcação aparece uma vez só.');
  END IF;
  SELECT count(*) INTO v_usadas FROM jsonb_array_elements(p_marcas) m WHERE m->>'papel' <> 'ignorar';
  IF v_usadas = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_marcas', 'mensagem', 'Marque ao menos um horário como Saída ou Retorno.');
  END IF;

  -- o dia tem de existir (a releitura corrige o que foi importado; não cria dia do nada)
  SELECT p.plant_id, p.upload_id, COALESCE(p.tipo, 'termica_253') AS tipo INTO v_base
    FROM public.ind_ponto_pausa p WHERE p.company_id = p_company_id AND p.cpf = p_cpf AND p.data = p_data
   ORDER BY p.inicio NULLS LAST LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'dia_sem_pausas', 'mensagem', 'Não há pausas importadas deste colaborador neste dia.');
  END IF;
  SELECT count(*) INTO v_n_antes FROM public.ind_ponto_pausa WHERE company_id = p_company_id AND cpf = p_cpf AND data = p_data;

  -- 1) histórico: cópia integral das linhas do dia (RD-30), no lote desta releitura
  INSERT INTO public.nr36_pausa_historico (pausa_id_original, company_id, plant_id, cpf, data, inicio, fim, duracao_seg, tipo,
    point_id, raw, sincronizado_em, upload_id, em_aberto, classe_evento, fim_origem, fim_sugerido, fim_sugerido_tipo,
    fim_confirmado, inicio_origem, arquivado_motivo, referencia)
  SELECT p.id, p.company_id, p.plant_id, p.cpf, p.data, p.inicio, p.fim, p.duracao_seg, p.tipo, p.point_id, p.raw,
    p.sincronizado_em, p.upload_id, p.em_aberto, p.classe_evento, p.fim_origem, p.fim_sugerido, p.fim_sugerido_tipo,
    p.fim_confirmado, p.inicio_origem,
    'Conferência: a responsável indicou o que cada horário é (saída/retorno/ignorar) e o dia foi relido. Esta é a leitura anterior.',
    '#256 lote ' || v_lote
  FROM public.ind_ponto_pausa p WHERE p.company_id = p_company_id AND p.cpf = p_cpf AND p.data = p_data;
  GET DIAGNOSTICS v_arq = ROW_COUNT;
  DELETE FROM public.ind_ponto_pausa p
   WHERE p.company_id = p_company_id AND p.cpf = p_cpf AND p.data = p_data
     AND EXISTS (SELECT 1 FROM public.nr36_pausa_historico h WHERE h.pausa_id_original = p.id AND h.referencia = '#256 lote ' || v_lote);

  -- 2) pares novos, em ordem de horário
  v_aberta := NULL; v_aberta_manual := false;
  FOR v_m IN
    SELECT m->>'hora' AS hora, m->>'papel' AS papel, COALESCE(m->>'origem','arquivo') = 'manual' AS manual
      FROM jsonb_array_elements(p_marcas) m WHERE m->>'papel' <> 'ignorar' ORDER BY m->>'hora'
  LOOP
    v_ts := ((p_data::text || ' ' || v_m.hora)::timestamp AT TIME ZONE 'America/Sao_Paulo');
    IF v_m.papel = 'saida' THEN
      IF v_aberta IS NOT NULL THEN   -- saída seguida de saída: a anterior fica sem retorno
        INSERT INTO public.ind_ponto_pausa (company_id, plant_id, cpf, data, inicio, fim, duracao_seg, tipo, upload_id, raw, sincronizado_em, inicio_origem)
        VALUES (p_company_id, v_base.plant_id, p_cpf, p_data, v_aberta, NULL, NULL, v_base.tipo, v_base.upload_id,
          jsonb_build_object('reler', '#256', 'lote', v_lote, 'por', auth.uid(), 'situacao', 'sem_retorno'), now(),
          CASE WHEN v_aberta_manual THEN 'manual' END);
        v_novas := v_novas + 1;
      END IF;
      v_aberta := v_ts; v_aberta_manual := v_m.manual;
    ELSIF v_aberta IS NOT NULL THEN   -- retorno fecha a saída aberta
      INSERT INTO public.ind_ponto_pausa (company_id, plant_id, cpf, data, inicio, fim, duracao_seg, tipo, upload_id, raw, sincronizado_em,
        inicio_origem, fim_origem, fim_confirmado)
      VALUES (p_company_id, v_base.plant_id, p_cpf, p_data, v_aberta, v_ts, EXTRACT(EPOCH FROM (v_ts - v_aberta))::int, v_base.tipo, v_base.upload_id,
        jsonb_build_object('reler', '#256', 'lote', v_lote, 'por', auth.uid(), 'situacao', 'fechada'), now(),
        CASE WHEN v_aberta_manual THEN 'manual' END,
        CASE WHEN v_m.manual THEN 'confirmado_manual' END,
        CASE WHEN v_m.manual THEN v_ts END);
      v_novas := v_novas + 1;
      v_aberta := NULL; v_aberta_manual := false;
    ELSE                              -- retorno sem saída: a saída não é inventada (RD-38). A linha guarda o horário do
                                      -- RETORNO, sem fim e com inicio_origem='sem_saida': fica pendente na Conferência.
      INSERT INTO public.ind_ponto_pausa (company_id, plant_id, cpf, data, inicio, fim, duracao_seg, tipo, upload_id, raw, sincronizado_em, inicio_origem)
      VALUES (p_company_id, v_base.plant_id, p_cpf, p_data, v_ts, NULL, NULL, v_base.tipo, v_base.upload_id,
        jsonb_build_object('reler', '#256', 'lote', v_lote, 'por', auth.uid(), 'situacao', 'sem_saida'), now(), 'sem_saida');
      v_novas := v_novas + 1;
    END IF;
  END LOOP;
  IF v_aberta IS NOT NULL THEN
    INSERT INTO public.ind_ponto_pausa (company_id, plant_id, cpf, data, inicio, fim, duracao_seg, tipo, upload_id, raw, sincronizado_em, inicio_origem)
    VALUES (p_company_id, v_base.plant_id, p_cpf, p_data, v_aberta, NULL, NULL, v_base.tipo, v_base.upload_id,
      jsonb_build_object('reler', '#256', 'lote', v_lote, 'por', auth.uid(), 'situacao', 'sem_retorno'), now(),
      CASE WHEN v_aberta_manual THEN 'manual' END);
    v_novas := v_novas + 1;
  END IF;

  -- 3) classe de cada pausa pela régua do tenant + apuração do dia (o Painel já mostra o resultado)
  PERFORM public.fn_nr36_classificar_eventos(p_company_id);
  PERFORM public.fn_nr36_apurar(p_company_id, p_data, p_data);

  RETURN jsonb_build_object('ok', true, 'lote', v_lote, 'arquivadas', v_arq, 'pausas', v_novas,
    'pausas_dia', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'inicio', to_char(p.inicio AT TIME ZONE 'America/Sao_Paulo','HH24:MI'),
        'fim', to_char(COALESCE(p.fim_confirmado, p.fim) AT TIME ZONE 'America/Sao_Paulo','HH24:MI'),
        'minutos', round(p.duracao_seg / 60.0), 'classe', p.classe_evento) ORDER BY p.inicio NULLS FIRST), '[]'::jsonb)
      FROM public.ind_ponto_pausa p WHERE p.company_id = p_company_id AND p.cpf = p_cpf AND p.data = p_data));
END $function$;
REVOKE ALL ON FUNCTION public.fn_nr36_reler_dia(uuid, text, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_reler_dia(uuid, text, date, jsonb) TO authenticated, service_role;

-- ── desfazer a última releitura do dia ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_reler_dia_desfazer(p_company_id uuid, p_cpf text, p_data date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_lote text; v_desfeitas int; v_restauradas int;
BEGIN
  PERFORM public.fn_nr36_assert(p_company_id);
  SELECT p.raw->>'lote' INTO v_lote FROM public.ind_ponto_pausa p
   WHERE p.company_id = p_company_id AND p.cpf = p_cpf AND p.data = p_data AND p.raw->>'reler' = '#256'
   ORDER BY p.sincronizado_em DESC LIMIT 1;
  IF v_lote IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nada_a_desfazer', 'mensagem', 'Este dia não foi relido na Conferência.');
  END IF;
  -- a releitura desfeita também fica no histórico (nada some — RD-30)
  INSERT INTO public.nr36_pausa_historico (pausa_id_original, company_id, plant_id, cpf, data, inicio, fim, duracao_seg, tipo,
    point_id, raw, sincronizado_em, upload_id, em_aberto, classe_evento, fim_origem, fim_sugerido, fim_sugerido_tipo,
    fim_confirmado, inicio_origem, arquivado_motivo, referencia)
  SELECT p.id, p.company_id, p.plant_id, p.cpf, p.data, p.inicio, p.fim, p.duracao_seg, p.tipo, p.point_id, p.raw,
    p.sincronizado_em, p.upload_id, p.em_aberto, p.classe_evento, p.fim_origem, p.fim_sugerido, p.fim_sugerido_tipo,
    p.fim_confirmado, p.inicio_origem, 'Conferência: releitura desfeita pela responsável.', '#256 desfeito ' || v_lote
  FROM public.ind_ponto_pausa p
  WHERE p.company_id = p_company_id AND p.cpf = p_cpf AND p.data = p_data AND p.raw->>'lote' = v_lote;
  DELETE FROM public.ind_ponto_pausa p
   WHERE p.company_id = p_company_id AND p.cpf = p_cpf AND p.data = p_data AND p.raw->>'lote' = v_lote;
  GET DIAGNOSTICS v_desfeitas = ROW_COUNT;
  -- volta a leitura anterior, com o mesmo id de antes
  INSERT INTO public.ind_ponto_pausa (id, company_id, plant_id, cpf, data, inicio, fim, duracao_seg, tipo, point_id, raw,
    sincronizado_em, upload_id, classe_evento, fim_origem, fim_sugerido, fim_sugerido_tipo, fim_confirmado, inicio_origem)
  SELECT h.pausa_id_original, h.company_id, h.plant_id, h.cpf, h.data, h.inicio, h.fim, h.duracao_seg, h.tipo, h.point_id, h.raw,
    h.sincronizado_em, h.upload_id, h.classe_evento, h.fim_origem, h.fim_sugerido, h.fim_sugerido_tipo, h.fim_confirmado, h.inicio_origem
  FROM public.nr36_pausa_historico h
  WHERE h.company_id = p_company_id AND h.cpf = p_cpf AND h.data = p_data AND h.referencia = '#256 lote ' || v_lote
    AND h.restaurado_em IS NULL;
  GET DIAGNOSTICS v_restauradas = ROW_COUNT;
  UPDATE public.nr36_pausa_historico SET restaurado_em = now()
   WHERE company_id = p_company_id AND cpf = p_cpf AND data = p_data AND referencia = '#256 lote ' || v_lote AND restaurado_em IS NULL;

  PERFORM public.fn_nr36_classificar_eventos(p_company_id);
  PERFORM public.fn_nr36_apurar(p_company_id, p_data, p_data);
  RETURN jsonb_build_object('ok', true, 'desfeitas', v_desfeitas, 'restauradas', v_restauradas);
END $function$;
REVOKE ALL ON FUNCTION public.fn_nr36_reler_dia_desfazer(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_reler_dia_desfazer(uuid, text, date) TO authenticated, service_role;

-- ── confirmar fim: pausa sem hora de saída não se fecha pelo fim ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nr36_confirmar_fim_pausa(p_pausa_id uuid, p_acao text, p_fim_manual timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_p record; v_fim timestamptz; v_origem text;
BEGIN
  SELECT company_id, inicio_origem, fim_sugerido, fim_sugerido_tipo INTO v_p FROM public.ind_ponto_pausa WHERE id=p_pausa_id;
  IF v_p IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;
  IF NOT (v_p.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  -- #256: sem hora de saída não há duração — confirmar o fim fecharia a pausa com duração vazia. Só "Não sei" vale;
  -- a saída se informa no editor de marcações do dia (fn_nr36_reler_dia).
  IF v_p.inicio_origem = 'sem_saida' AND p_acao <> 'indeterminado' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_saida',
      'mensagem', 'Esta pausa não tem hora de saída. Informe a saída em "Saída/retorno" ou marque "Não sei".');
  END IF;
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
REVOKE ALL ON FUNCTION public.fn_nr36_confirmar_fim_pausa(uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_confirmar_fim_pausa(uuid, text, timestamptz) TO authenticated, service_role;

-- ── pendentes: devolve sem_saida (DROP porque o retorno muda de forma; os mesmos GRANTs) ───────────────────────
DROP FUNCTION IF EXISTS public.fn_nr36_pausas_pendentes_listar(uuid, integer);
CREATE FUNCTION public.fn_nr36_pausas_pendentes_listar(p_company_id uuid, p_limite integer DEFAULT 1000)
 RETURNS TABLE(pausa_id uuid, cpf text, colaborador text, data date, classe_evento text, inicio_local text, fim_sugerido_local text, fim_sugerido_tipo text, batida_local text, minutos_ate_batida numeric, sem_saida boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN; END IF;
  RETURN QUERY
  SELECT p.id, p.cpf,
    COALESCE(c.nome, p.cpf) AS colaborador,
    p.data, p.classe_evento,
    to_char(p.inicio AT TIME ZONE 'America/Sao_Paulo','HH24:MI'),
    to_char(p.fim_sugerido AT TIME ZONE 'America/Sao_Paulo','HH24:MI'),
    p.fim_sugerido_tipo,
    CASE WHEN p.fim_sugerido_tipo='batida_forte' THEN to_char(p.fim_sugerido AT TIME ZONE 'America/Sao_Paulo','HH24:MI') ELSE NULL END,
    NULL::numeric,
    COALESCE(p.inicio_origem = 'sem_saida', false)
  FROM public.ind_ponto_pausa p
  LEFT JOIN public.ind_ponto_colaborador c ON c.company_id=p.company_id AND c.cpf=p.cpf
  WHERE p.company_id = p_company_id
    AND public.fn_nr36_fim_origem_efetiva(p.fim, p.classe_evento, p.fim_origem) IS NULL
  ORDER BY p.data, p.cpf, p.inicio
  LIMIT p_limite;
END $function$;
REVOKE ALL ON FUNCTION public.fn_nr36_pausas_pendentes_listar(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_pausas_pendentes_listar(uuid, integer) TO authenticated, service_role;

-- guarda final
DO $$
BEGIN
  IF pg_get_functiondef('public.fn_nr36_confirmar_fim_pausa(uuid,text,timestamptz)'::regprocedure) !~ '#256'
     OR to_regprocedure('public.fn_nr36_reler_dia(uuid,text,date,jsonb)') IS NULL
     OR to_regprocedure('public.fn_nr36_reler_dia_desfazer(uuid,text,date)') IS NULL
     OR to_regprocedure('public.fn_nr36_marcas_dia(uuid,text,date)') IS NULL THEN
    RAISE EXCEPTION '#256: funções da releitura não ficaram como esperado';
  END IF;
END $$;
