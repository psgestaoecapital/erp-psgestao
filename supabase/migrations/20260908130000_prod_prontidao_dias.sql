-- ============================================================
-- Fix · fn_prod_prontidao · "dias de ponto" estava contando MARCACOES.
-- ind_ponto_marcacao = cada batida (~4 por pessoa-dia) -> Frioeste 87.464 (o numero errado).
-- ind_ponto_dia = pessoa-dia (a unidade certa de "dia de ponto") -> 22.845, em 245 datas distintas.
-- Passa a devolver dias_com_ponto (de ind_ponto_dia) + datas_distintas. Resto inalterado.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_prod_prontidao(p_company_id uuid, p_plant_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_postos int; v_quadros int; v_svinc int; v_dias int; v_datas int; v_fluxos int;
        v_vponto int; v_prod jsonb; v_falta text[] := '{}';
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT count(*) INTO v_postos FROM prod_posto
   WHERE company_id=p_company_id AND plant_id=p_plant_id AND ativo IS NOT FALSE;
  SELECT count(*) INTO v_quadros FROM prod_posto_turno pt JOIN prod_posto p ON p.id=pt.posto_id
   WHERE p.company_id=p_company_id AND p.plant_id=p_plant_id AND pt.vigencia_fim IS NULL;
  SELECT count(DISTINCT setor_id) INTO v_svinc FROM prod_setor_vinculo
   WHERE company_id=p_company_id AND plant_id=p_plant_id;
  SELECT count(*) INTO v_fluxos FROM prod_fluxo WHERE company_id=p_company_id AND plant_id=p_plant_id;
  -- "dias de ponto" = pessoa-dia (ind_ponto_dia), NAO marcacoes (ind_ponto_marcacao ~4x).
  SELECT count(*), count(DISTINCT data) INTO v_dias, v_datas
    FROM ind_ponto_dia WHERE company_id=p_company_id AND plant_id=p_plant_id;
  SELECT count(*) INTO v_vponto FROM prod_setor_vinculo sv JOIN prod_fonte_dados f ON f.id=sv.fonte_id
   WHERE sv.company_id=p_company_id AND sv.plant_id=p_plant_id AND f.tipo='ponto';
  SELECT coalesce(jsonb_agg(DISTINCT sv.chave), '[]'::jsonb) INTO v_prod
   FROM prod_setor_vinculo sv JOIN prod_fonte_dados f ON f.id=sv.fonte_id
   WHERE sv.company_id=p_company_id AND sv.plant_id=p_plant_id AND f.tipo='producao';

  IF v_postos  = 0 THEN v_falta := array_append(v_falta, 'nenhum posto cadastrado'); END IF;
  IF v_quadros = 0 THEN v_falta := array_append(v_falta, 'nenhum posto tem quadro de turno'); END IF;
  IF v_svinc   = 0 THEN v_falta := array_append(v_falta, 'nenhum setor vinculado a uma base (ponto ou producao)'); END IF;

  RETURN jsonb_build_object('ok', true,
    'pronto_para_medir', (v_postos > 0 AND v_quadros > 0 AND v_svinc > 0),
    'falta', v_falta,
    'tem', jsonb_build_object('setores_com_vinculo', v_svinc, 'postos', v_postos, 'quadros', v_quadros,
       'dias_com_ponto', v_dias, 'datas_distintas', v_datas, 'vinculos_ponto', v_vponto,
       'producao_chaves', v_prod, 'fluxos', v_fluxos));
END $function$;
