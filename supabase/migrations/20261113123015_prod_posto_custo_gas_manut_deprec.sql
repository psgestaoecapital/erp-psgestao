-- Tarefa b759a587 (Diretriz CEO 11/11, contexto 46b4527a, RD-102) — Custeio por kg, fatia F3.
-- BACKEND da "Custos do posto": prod_posto_custo já guarda energia/água/vapor/frio/ar comprimido/outros
-- e horas de operação. Faltam, no modelo, GÁS, MANUTENÇÃO (peças/serviços) e DEPRECIAÇÃO — e a RPC de
-- gravação (fn_prod_posto_custo_salvar) não os aceita. Esta migration ADITIVA cobre o modelo para a
-- tela de Custos do posto (próxima PR) e para o custo por kg (F6), genérico para qualquer planta.
--
-- RD-97: ADITIVA — 3 colunas NOVAS (default NULL) + CREATE OR REPLACE que só ACRESCENTA 3 chaves
-- opcionais à RPC. Chamadores atuais (que não enviam gás/manutenção/depreciação) seguem idênticos
-- (gravam NULL, como hoje). NÃO altera fn_prod_posto_custo_hora_interno (RD-97) — o rateio do custo/h
-- com os novos itens entra na fatia F6, à parte.
-- Segurança: a RPC mantém SECURITY DEFINER + guarda por empresa (get_user_company_ids/is_admin).

ALTER TABLE public.prod_posto_custo
  ADD COLUMN IF NOT EXISTS gas_mes         numeric,
  ADD COLUMN IF NOT EXISTS manutencao_mes  numeric,
  ADD COLUMN IF NOT EXISTS depreciacao_mes numeric;

COMMENT ON COLUMN public.prod_posto_custo.gas_mes         IS 'b759a587/F3 — custo mensal de gás do posto (R$)';
COMMENT ON COLUMN public.prod_posto_custo.manutencao_mes  IS 'b759a587/F3 — custo mensal de manutenção (peças/serviços) do posto (R$)';
COMMENT ON COLUMN public.prod_posto_custo.depreciacao_mes IS 'b759a587/F3 — depreciação mensal do posto (R$)';

CREATE OR REPLACE FUNCTION public.fn_prod_posto_custo_salvar(p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_posto uuid := NULLIF(p_dados->>'posto_id','')::uuid;
  v_comp uuid; v_plant uuid;
  v_ini date := coalesce(NULLIF(p_dados->>'vigencia_inicio','')::date, current_date);
  v_id uuid;
BEGIN
  SELECT company_id, plant_id INTO v_comp, v_plant FROM prod_posto WHERE id = v_posto;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'posto_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- Encerra a vigência anterior e substitui a do mesmo dia (idempotente).
  UPDATE prod_posto_custo SET vigencia_fim = v_ini - 1
   WHERE posto_id = v_posto AND deleted_at IS NULL AND vigencia_fim IS NULL AND vigencia_inicio < v_ini;
  UPDATE prod_posto_custo SET deleted_at = now(), deleted_by = auth.uid()
   WHERE posto_id = v_posto AND deleted_at IS NULL AND vigencia_inicio = v_ini;

  INSERT INTO prod_posto_custo (company_id, plant_id, posto_id, vigencia_inicio, mao_obra_mes, encargos_pct,
      energia_mes, energia_kwh_mes, energia_tarifa_kwh, agua_mes, vapor_mes, frio_mes, ar_comprimido_mes,
      gas_mes, manutencao_mes, depreciacao_mes, outros_mes, horas_operacao_mes, criado_por)
  VALUES (v_comp, v_plant, v_posto, v_ini, NULLIF(p_dados->>'mao_obra_mes','')::numeric, coalesce(NULLIF(p_dados->>'encargos_pct','')::numeric, 0),
      NULLIF(p_dados->>'energia_mes','')::numeric, NULLIF(p_dados->>'energia_kwh_mes','')::numeric, NULLIF(p_dados->>'energia_tarifa_kwh','')::numeric,
      NULLIF(p_dados->>'agua_mes','')::numeric, NULLIF(p_dados->>'vapor_mes','')::numeric, NULLIF(p_dados->>'frio_mes','')::numeric,
      NULLIF(p_dados->>'ar_comprimido_mes','')::numeric,
      NULLIF(p_dados->>'gas_mes','')::numeric, NULLIF(p_dados->>'manutencao_mes','')::numeric, NULLIF(p_dados->>'depreciacao_mes','')::numeric,
      NULLIF(p_dados->>'outros_mes','')::numeric, NULLIF(p_dados->>'horas_operacao_mes','')::numeric, auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_prod_posto_custo_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_posto_custo_salvar(jsonb) TO authenticated, service_role;
