-- Aba Codes · fatia 4 do painel de desempenho (CEO 09/10): o job do GitHub preenche main/deploy e o tempo até a
-- autorização do revisor no último retrato. Faixa 05 (gilberto-produto). Só função NOVA, sem tabela nova; só service_role.
-- Só atualiza a linha mais recente do próprio snapshot (nunca dado de cliente nem das fontes).
CREATE OR REPLACE FUNCTION public.fn_dev_codes_snapshot_github(
  p_main text, p_deploy text, p_tempo_autorizacao_min numeric DEFAULT NULL
) RETURNS bigint
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id bigint;
BEGIN
  IF p_main NOT IN ('verde','vermelho','desconhecido') OR p_deploy NOT IN ('verde','vermelho','desconhecido') THEN
    RAISE EXCEPTION 'estado inválido (verde|vermelho|desconhecido)';
  END IF;
  SELECT id INTO v_id FROM erp_dev_codes_snapshot WHERE capturado_em > now() - interval '20 minutes'
   ORDER BY capturado_em DESC LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO erp_dev_codes_snapshot (main_estado, deploy_estado, tempo_ate_autorizacao_min)
    VALUES (p_main, p_deploy, p_tempo_autorizacao_min) RETURNING id INTO v_id;
  ELSE
    UPDATE erp_dev_codes_snapshot SET main_estado = p_main, deploy_estado = p_deploy,
      tempo_ate_autorizacao_min = p_tempo_autorizacao_min WHERE id = v_id;
  END IF;
  RETURN v_id;
END $function$;
REVOKE ALL ON FUNCTION public.fn_dev_codes_snapshot_github(text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_dev_codes_snapshot_github(text, text, numeric) TO service_role;
COMMENT ON FUNCTION public.fn_dev_codes_snapshot_github(text, text, numeric) IS
  'Chamada pelo workflow codes-snapshot-github (a cada 15 min): grava estado da main/deploy e tempo até autorização no retrato recente.';
