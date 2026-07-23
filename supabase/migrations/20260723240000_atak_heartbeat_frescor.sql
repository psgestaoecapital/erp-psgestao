-- ATAK · Cão de guarda + Selo de Frescor. RD-26 (reusa erp_sync_log/erp_alerta_proativo),
-- RD-51 (sem dado NÃO vira zero nem "hoje" — vira 'sem_dado' declarado), RD-52 (fonte única).
-- NÃO cria tabela nova nem coluna nova (proibido pelo SPEC).

-- 1.1 · Cão de guarda usa erp_sync_log com trigger_type='coletor_atak' (novo canal, distinto de
-- cron/manual/webhook do Omie). Additive (RD-55): estende o CHECK, não recria a tabela.
-- Obs.: a fase de erro reusa 'falha' (vocabulário já existente) — NÃO cria sinônimo 'erro' (RD-52).
ALTER TABLE public.erp_sync_log DROP CONSTRAINT erp_sync_log_trigger_type_check;
ALTER TABLE public.erp_sync_log ADD CONSTRAINT erp_sync_log_trigger_type_check
  CHECK (trigger_type = ANY (ARRAY['cron'::text,'manual'::text,'webhook'::text,'coletor_atak'::text]));

-- 1.2 · SELO DE FRESCOR — GENÉRICO desde o dia 1 (serve BI de Gente, DRE, Conciliação, Agro,
-- Industrial). SECURITY INVOKER → respeita a RLS multi-tenant da fonte lida.
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
    SELECT max(data_abate), max(imported_at)
      INTO v_data_ate, v_ultimo_sync
      FROM ind_abate_atak
     WHERE company_id = p_company_id;
  ELSE
    -- fontes futuras entram aqui (ponto, conciliacao, agro, dre...)
    RETURN jsonb_build_object('fonte', p_fonte, 'status', 'fonte_nao_mapeada');
  END IF;

  -- RD-51: sem dado NAO vira zero nem hoje. Vira "sem dado" declarado.
  IF v_ultimo_sync IS NULL THEN
    RETURN jsonb_build_object(
      'fonte', p_fonte, 'status', 'sem_dado',
      'data_ate', NULL, 'ultimo_sync', NULL,
      'rotulo', 'sem dado para esta fonte');
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
    'rotulo', 'dados até ' || to_char(v_data_ate,'DD/MM') ||
              ' · sincronizado há ' || v_horas || 'h'
  );
END $function$;

REVOKE ALL ON FUNCTION public.fn_frescor_fonte(uuid,text) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_frescor_fonte(uuid,text) TO authenticated;

-- 1.3 · MOTOR do alerta de silêncio (o CRON que o chama fica em migration separada,
-- aplicada só com GO do CEO). Reusa erp_alerta_proativo (JÁ existe, usado na Oficina).
-- SECURITY DEFINER porque roda no contexto do cron (sem usuário). Idempotente: enquanto
-- houver 1 alerta 'atak_silencio' ABERTO (não resolvido, não dispensado), não cria outro.
CREATE OR REPLACE FUNCTION public.fn_atak_alerta_silencio(
  p_company_id uuid DEFAULT '975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ultimo_sync timestamptz;
  v_horas numeric;
  v_host text;
  v_ja_aberto boolean;
  v_dia_util boolean := extract(isodow FROM (now() AT TIME ZONE 'America/Sao_Paulo')) BETWEEN 1 AND 5;
BEGIN
  IF NOT v_dia_util THEN
    RETURN jsonb_build_object('ok', true, 'acao', 'ignorado_fim_de_semana');
  END IF;

  SELECT max(imported_at) INTO v_ultimo_sync
    FROM ind_abate_atak WHERE company_id = p_company_id;

  -- Sem NENHUM dado ainda: não é "silêncio de máquina", é "nunca coletou" — não spamar.
  IF v_ultimo_sync IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'acao', 'sem_dado_ainda');
  END IF;

  v_horas := round(extract(epoch FROM (now() - v_ultimo_sync))/3600, 1);
  IF v_horas <= 12 THEN
    RETURN jsonb_build_object('ok', true, 'acao', 'ok', 'horas_desde_sync', v_horas);
  END IF;

  -- já existe alerta aberto? não duplica.
  SELECT EXISTS (
    SELECT 1 FROM erp_alerta_proativo
     WHERE company_id = p_company_id AND tipo = 'atak_silencio'
       AND coalesce(resolvido,false) = false AND coalesce(dispensado,false) = false
  ) INTO v_ja_aberto;
  IF v_ja_aberto THEN
    RETURN jsonb_build_object('ok', true, 'acao', 'alerta_ja_aberto', 'horas_desde_sync', v_horas);
  END IF;

  -- último host conhecido (do heartbeat do coletor).
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
    'O coletor de abate não envia dados desde ' ||
      to_char(v_ultimo_sync AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') ||
      '. Verificar a máquina ' || coalesce(v_host, 'desconhecida') || '.',
    'alta',
    jsonb_build_object(
      'fonte','atak_abate','horas_desde_sync', v_horas,
      'ultimo_sync', v_ultimo_sync, 'host', v_host)
  );

  RETURN jsonb_build_object('ok', true, 'acao', 'alerta_criado',
    'horas_desde_sync', v_horas, 'host', coalesce(v_host,'desconhecida'));
END $function$;

REVOKE ALL ON FUNCTION public.fn_atak_alerta_silencio(uuid) FROM public;
-- executado pelo cron (postgres) — não exposto a authenticated.
