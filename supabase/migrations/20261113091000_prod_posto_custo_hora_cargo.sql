-- PR-B (CEO 11/11, Frioeste) — R$/h no POSTO pelo CARGO do posto.
-- Regra: R$/h do posto = R$/h médio do CARGO do posto (fn_rh_custo_hora_cargo, PR-A) × pessoas do quadro
-- vigente do posto (prod_posto_turno.pessoas). Função NOVA; NÃO toca fn_prod_posto_custo_hora_interno (RD-97).
-- LGPD: valor só para RH/diretoria/admin (fn__rh_pode_custo). Posto sem cargo → orienta a escolher o cargo.
-- ADITIVA. Depende da PR-A (fn_rh_custo_hora_cargo, fn__rh_pode_custo) — deve ser publicada DEPOIS da PR-A.

CREATE OR REPLACE FUNCTION public.fn_prod_posto_custo_hora_cargo(p_posto_id uuid, p_ref date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_company uuid; v_cargo uuid; v_pode boolean; v_rh numeric; v_pessoas numeric; v_ref date;
BEGIN
  v_ref := COALESCE(p_ref, CURRENT_DATE);
  SELECT company_id, cargo_id INTO v_company, v_cargo FROM prod_posto WHERE id = p_posto_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'posto_nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  IF v_cargo IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'tem_cargo', false, 'motivo', 'escolha o cargo para o posto ter custo');
  END IF;

  v_pode := fn__rh_pode_custo(v_company);
  v_rh := fn_rh_custo_hora_cargo(v_company, v_cargo, v_ref);  -- R$/h médio do cargo (PR-A)
  SELECT COALESCE(sum(t.pessoas), 0) INTO v_pessoas
    FROM prod_posto_turno t
   WHERE t.posto_id = p_posto_id
     AND t.vigencia_inicio <= v_ref
     AND (t.vigencia_fim IS NULL OR t.vigencia_fim >= v_ref);

  RETURN jsonb_build_object(
    'ok', true, 'tem_cargo', true, 'cargo_id', v_cargo, 'pessoas', v_pessoas,
    'rh_cargo', CASE WHEN v_pode THEN v_rh ELSE NULL END,
    'custo_hora_posto', CASE WHEN v_pode THEN round(COALESCE(v_rh,0) * COALESCE(v_pessoas,0), 2) ELSE NULL END,
    'pode_custo', v_pode);
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_prod_posto_custo_hora_cargo(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_posto_custo_hora_cargo(uuid, date) TO authenticated, service_role;

-- Versão em lote para a tela de Postos (uma chamada por empresa/planta; evita N chamadas).
CREATE OR REPLACE FUNCTION public.fn_prod_postos_custo_hora_cargo(p_company_id uuid, p_plant_id uuid DEFAULT NULL, p_ref date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_pode boolean; v_ref date; v_lista jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  v_ref := COALESCE(p_ref, CURRENT_DATE);
  v_pode := fn__rh_pode_custo(p_company_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'posto_id', p.id, 'tem_cargo', p.cargo_id IS NOT NULL, 'cargo_id', p.cargo_id,
      'pessoas', COALESCE(tt.pessoas, 0),
      'rh_cargo', CASE WHEN v_pode AND p.cargo_id IS NOT NULL THEN fn_rh_custo_hora_cargo(p_company_id, p.cargo_id, v_ref) ELSE NULL END,
      'custo_hora_posto', CASE WHEN v_pode AND p.cargo_id IS NOT NULL
             THEN round(COALESCE(fn_rh_custo_hora_cargo(p_company_id, p.cargo_id, v_ref),0) * COALESCE(tt.pessoas,0), 2) ELSE NULL END
    )), '[]'::jsonb) INTO v_lista
  FROM prod_posto p
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(t.pessoas),0) AS pessoas FROM prod_posto_turno t
     WHERE t.posto_id = p.id AND t.vigencia_inicio <= v_ref AND (t.vigencia_fim IS NULL OR t.vigencia_fim >= v_ref)
  ) tt ON true
  WHERE p.company_id = p_company_id AND (p_plant_id IS NULL OR p.plant_id = p_plant_id) AND p.ativo;

  RETURN jsonb_build_object('ok', true, 'pode_custo', v_pode, 'postos', v_lista);
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_prod_postos_custo_hora_cargo(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_postos_custo_hora_cargo(uuid, uuid, date) TO authenticated, service_role;
