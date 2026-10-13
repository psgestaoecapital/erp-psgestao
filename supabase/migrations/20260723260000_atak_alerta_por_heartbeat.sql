-- ATAK · corrige o cão de guarda: mede o COLETOR (heartbeat em erp_sync_log),
-- não o ABATE (max(imported_at)). Sem isto, num servidor sempre ligado um dia SEM abate
-- (feriado, parada, segunda após emenda) geraria alarme falso "coletor parado" — o coletor
-- roda e reporta heartbeat mesmo com 0 cabeças novas, mas imported_at não avança.
-- Regra: liveness = último heartbeat de sucesso; recência do dado = max(data_abate) (separados).

-- SELO DE FRESCOR — 'atak_abate' passa a separar as duas verdades:
--   data_ate     = max(data_abate)      → "quão recente é o dado"
--   ultimo_sync  = último heartbeat OK   → "o coletor está reportando?"
CREATE OR REPLACE FUNCTION public.fn_frescor_fonte(p_company_id uuid, p_fonte text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_data_ate date;
  v_ultimo_sync timestamptz;
  v_status text;
  v_horas numeric;
BEGIN
  IF p_fonte = 'atak_abate' THEN
    -- recência do DADO
    SELECT max(data_abate) INTO v_data_ate
      FROM ind_abate_atak WHERE company_id = p_company_id;
    -- liveness do COLETOR: último heartbeat de sucesso (conta mesmo em janela vazia)
    SELECT max(iniciado_em) INTO v_ultimo_sync
      FROM erp_sync_log
     WHERE company_id = p_company_id AND trigger_type = 'coletor_atak' AND fase = 'sucesso';
  ELSE
    RETURN jsonb_build_object('fonte', p_fonte, 'status', 'fonte_nao_mapeada');
  END IF;

  -- Coletor ainda não reportou heartbeat (RD-51: não inventa liveness).
  IF v_ultimo_sync IS NULL THEN
    RETURN jsonb_build_object(
      'fonte', p_fonte,
      'status', CASE WHEN v_data_ate IS NULL THEN 'sem_dado' ELSE 'sem_heartbeat' END,
      'data_ate', v_data_ate,
      'ultimo_sync', NULL,
      'rotulo', CASE WHEN v_data_ate IS NULL
                     THEN 'sem dado para esta fonte'
                     ELSE 'dados até ' || to_char(v_data_ate,'DD/MM') || ' · coletor ainda não reportou' END);
  END IF;

  v_horas := round(extract(epoch from (now() - v_ultimo_sync))/3600, 1);
  v_status := CASE
    WHEN v_horas <= 6  THEN 'fresco'
    WHEN v_horas <= 24 THEN 'atrasado'
    ELSE 'parado'
  END;

  RETURN jsonb_build_object(
    'fonte', p_fonte,
    'status', v_status,
    'data_ate', v_data_ate,
    'ultimo_sync', v_ultimo_sync,
    'horas_desde_sync', v_horas,
    'rotulo', 'dados até ' || coalesce(to_char(v_data_ate,'DD/MM'),'—') ||
              ' · sincronizado há ' || v_horas || 'h');
END $function$;

REVOKE ALL ON FUNCTION public.fn_frescor_fonte(uuid,text) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_frescor_fonte(uuid,text) TO authenticated;

-- ALERTA DE SILÊNCIO — passa a medir o HEARTBEAT do coletor, não o abate.
-- "sem_heartbeat_ainda" enquanto o coletor nunca reportou (não spama antes de existir).
CREATE OR REPLACE FUNCTION public.fn_atak_alerta_silencio(
  p_company_id uuid DEFAULT '975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ultimo_hb timestamptz;
  v_horas numeric;
  v_host text;
  v_ja_aberto boolean;
  v_dia_util boolean := extract(isodow FROM (now() AT TIME ZONE 'America/Sao_Paulo')) BETWEEN 1 AND 5;
BEGIN
  IF NOT v_dia_util THEN
    RETURN jsonb_build_object('ok', true, 'acao', 'ignorado_fim_de_semana');
  END IF;

  -- liveness pelo HEARTBEAT (não pelo abate): dia sem abate ≠ coletor parado.
  SELECT max(iniciado_em) INTO v_ultimo_hb
    FROM erp_sync_log
   WHERE company_id = p_company_id AND trigger_type = 'coletor_atak' AND fase = 'sucesso';

  -- Coletor nunca reportou: não é "silêncio de máquina", é "ainda não instalado". Não spama.
  IF v_ultimo_hb IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'acao', 'sem_heartbeat_ainda');
  END IF;

  v_horas := round(extract(epoch FROM (now() - v_ultimo_hb))/3600, 1);
  IF v_horas <= 12 THEN
    RETURN jsonb_build_object('ok', true, 'acao', 'ok', 'horas_desde_sync', v_horas);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM erp_alerta_proativo
     WHERE company_id = p_company_id AND tipo = 'atak_silencio'
       AND coalesce(resolvido,false) = false AND coalesce(dispensado,false) = false
  ) INTO v_ja_aberto;
  IF v_ja_aberto THEN
    RETURN jsonb_build_object('ok', true, 'acao', 'alerta_ja_aberto', 'horas_desde_sync', v_horas);
  END IF;

  -- host do último heartbeat conhecido.
  SELECT http_response->>'host' INTO v_host
    FROM erp_sync_log
   WHERE company_id = p_company_id AND trigger_type = 'coletor_atak'
     AND http_response ? 'host' AND coalesce(http_response->>'host','') <> ''
   ORDER BY iniciado_em DESC LIMIT 1;

  INSERT INTO erp_alerta_proativo (company_id, tipo, titulo, mensagem, severidade, contexto)
  VALUES (
    p_company_id,
    'atak_silencio',
    'Coletor de abate parado',
    'O coletor de abate não reporta desde ' ||
      to_char(v_ultimo_hb AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') ||
      '. Verificar a máquina ' || coalesce(v_host, 'desconhecida') || '.',
    'alta',
    jsonb_build_object(
      'fonte','coletor_atak','base','heartbeat','horas_desde_sync', v_horas,
      'ultimo_heartbeat', v_ultimo_hb, 'host', v_host)
  );

  RETURN jsonb_build_object('ok', true, 'acao', 'alerta_criado',
    'horas_desde_sync', v_horas, 'host', coalesce(v_host,'desconhecida'));
END $function$;

REVOKE ALL ON FUNCTION public.fn_atak_alerta_silencio(uuid) FROM public;
