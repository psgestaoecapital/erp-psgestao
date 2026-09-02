-- Módulo Produtividade Industrial · Fase 1 · RPCs com lógica de servidor.
-- CRUD simples de parâmetros vai por supabase.from() com RLS (padrão do codebase). Aqui ficam as
-- duas RPCs que têm lógica: (a) sugerir o fator cabeça→kg do ATAK (§4.1/§7.4 — sugere, nunca aplica),
-- (b) salvar quadro/horário do posto criando LINHA NOVA com vigência e fechando a anterior (§4.4/§8#7).

-- (a) Sugestão do fator cabeça→kg = média de peso_carcaca_total em ind_abate_atak. Só retorna; o
-- operador confirma e insere em prod_conversao com origem='medida'. Nunca grava sozinho.
CREATE OR REPLACE FUNCTION public.fn_prod_sugerir_fator_cabeca_kg(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_fator numeric; v_n int; v_ini date; v_fim date;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT round(avg(peso_carcaca_total), 2), count(*), min(data_abate), max(data_abate)
    INTO v_fator, v_n, v_ini, v_fim
    FROM ind_abate_atak
   WHERE company_id = p_company_id AND peso_carcaca_total IS NOT NULL AND peso_carcaca_total > 0;
  IF COALESCE(v_n, 0) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_dado_abate'); END IF;
  RETURN jsonb_build_object('ok', true, 'fator', v_fator, 'n_carcacas', v_n,
    'periodo_inicio', v_ini, 'periodo_fim', v_fim, 'origem', 'medida',
    'unidade_origem', 'cabeca', 'unidade_destino', 'kg');
END $function$;

-- (b) Salvar quadro/horário do posto num turno: fecha a vigência anterior aberta (vigencia_fim =
-- véspera do novo início) e cria linha nova. A anterior permanece consultável — cada dia é medido
-- com o quadro que existia naquele dia (§4.4).
CREATE OR REPLACE FUNCTION public.fn_prod_posto_turno_salvar(
  p_posto_id uuid, p_turno_id uuid, p_hora_entrada time, p_hora_saida time,
  p_pessoas numeric, p_vigencia_inicio date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_plant uuid; v_id uuid;
BEGIN
  SELECT company_id, plant_id INTO v_comp, v_plant FROM prod_posto WHERE id = p_posto_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'posto_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  UPDATE prod_posto_turno
     SET vigencia_fim = p_vigencia_inicio - 1
   WHERE posto_id = p_posto_id AND turno_id = p_turno_id
     AND vigencia_fim IS NULL AND vigencia_inicio < p_vigencia_inicio;

  INSERT INTO prod_posto_turno(company_id, plant_id, posto_id, turno_id, hora_entrada, hora_saida, pessoas, vigencia_inicio)
  VALUES (v_comp, v_plant, p_posto_id, p_turno_id, p_hora_entrada, p_hora_saida, p_pessoas, p_vigencia_inicio)
  ON CONFLICT (posto_id, turno_id, vigencia_inicio) DO UPDATE
     SET hora_entrada = EXCLUDED.hora_entrada, hora_saida = EXCLUDED.hora_saida, pessoas = EXCLUDED.pessoas
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_prod_sugerir_fator_cabeca_kg(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_prod_posto_turno_salvar(uuid, uuid, time, time, numeric, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_prod_sugerir_fator_cabeca_kg(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_prod_posto_turno_salvar(uuid, uuid, time, time, numeric, date) TO authenticated, service_role;
