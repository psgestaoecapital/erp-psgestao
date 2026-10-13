-- Revenda · Configuração da garagem: formato BR + campos opcionais (chamado Alliance #114 "deixar campos não
-- obrigatórios. E está dando falha"). O 22P02 do fn_veic_config_obter saiu no #1806; sobraram (prova 26/09):
--
-- 1) fn_veic_config_previa_efeito fazia NULLIF(...)::numeric em impostos/comissão/garantia/margem. O botão
--    "Salvar" SEMPRE pede a prévia antes → "4,5" em impostos dava 22P02 → "Falha ao calcular a prévia." e o
--    salvar nunca acontecia. Agora: fn_veic_num (aceita 4,5 / 72.956,00) e ok:false + campo quando é lixo.
-- 2) fn_veic_config_salvar: o 1º bloco engolia o erro (EXCEPTION → NULL) e, como "chave presente é
--    autoritativa", GRAVAVA NULO em impostos/comissão/garantia sem avisar — por isso o % de impostos da
--    Alliance nunca ficou salvo. O 2º UPDATE (vagas, custo fixo, taxa, meses, meta…) fazia ::int/::numeric
--    cru ("40.000,00" derrubava o salvar). Agora valida TUDO antes de gravar e devolve ok:false + campo.
-- 3) fn_veic_config_obter: "Falta configurar" listava 9 itens fixos como se todos fossem obrigatórios.
--    Obrigatório para o preço mínimo calcular: vagas e margem alvo. O resto vira 'opcionais_vazios'
--    (impostos, comissão e garantia separados — antes eram um item só). 'falta' continua existindo.
-- Sem DML em dado de cliente.

CREATE OR REPLACE FUNCTION public.fn_veic_config_obter(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v record; v_falta text[] := ARRAY[]::text[]; v_opc text[] := ARRAY[]::text[];
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT * INTO v FROM veic_config WHERE company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'existe', false,
      'falta', ARRAY['estrutura','margem']::text[],
      'opcionais_vazios', ARRAY['custo_fixo','capital','impostos','comissao_pct','garantia_pct','depreciacao','garantia','comissao','meta']::text[]);
  END IF;

  -- obrigatórios: sem eles o preço mínimo não calcula
  IF COALESCE(v.vagas_operacionais,0) <= 0 THEN v_falta := array_append(v_falta, 'estrutura'); END IF;
  IF v.margem_alvo_pct IS NULL THEN v_falta := array_append(v_falta, 'margem'); END IF;
  -- opcionais: melhoram a conta, mas a garagem opera sem eles
  IF v.custo_fixo_mensal_manual IS NULL AND (v.contas_rateio IS NULL OR array_length(v.contas_rateio,1) IS NULL) THEN v_opc := array_append(v_opc, 'custo_fixo'); END IF;
  IF v.taxa_capital_aa IS NULL THEN v_opc := array_append(v_opc, 'capital'); END IF;
  IF v.impostos_venda_pct IS NULL THEN v_opc := array_append(v_opc, 'impostos'); END IF;
  IF v.comissao_venda_pct IS NULL THEN v_opc := array_append(v_opc, 'comissao_pct'); END IF;
  IF v.provisao_garantia_pct IS NULL THEN v_opc := array_append(v_opc, 'garantia_pct'); END IF;
  IF v.depreciacao_fonte IS NULL THEN v_opc := array_append(v_opc, 'depreciacao'); END IF;
  IF v.garantia_prazo_meses IS NULL THEN v_opc := array_append(v_opc, 'garantia'); END IF;
  IF v.comissao_base IS NULL THEN v_opc := array_append(v_opc, 'comissao'); END IF;
  IF v.meta_veiculos_mes IS NULL THEN v_opc := array_append(v_opc, 'meta'); END IF;

  RETURN jsonb_build_object('ok', true, 'existe', true, 'falta', v_falta, 'opcionais_vazios', v_opc, 'config', to_jsonb(v),
    'carrego', fn_veic_carrego_parametros(p_company_id));
END $function$;

CREATE OR REPLACE FUNCTION public.fn_veic_config_previa_efeito(p_company_id uuid, p_config_nova jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_imp0 numeric; v_com0 numeric; v_gar0 numeric; v_margem0 numeric;
  v_imp1 numeric; v_com1 numeric; v_gar1 numeric; v_margem1 numeric;
  v_enc0 numeric; v_enc1 numeric; v_mudam int; v_total int; v_exemplos jsonb; k text; v_tmp numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- formato BR aceito ("4,5"); lixo volta com o campo (antes: 22P02 → "Falha ao calcular a prévia.")
  FOREACH k IN ARRAY ARRAY['impostos_venda_pct','comissao_venda_pct','provisao_garantia_pct','margem_alvo_pct'] LOOP
    IF p_config_nova ? k THEN
      BEGIN v_tmp := public.fn_veic_num(p_config_nova->>k);
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido', 'campo', k, 'valor', p_config_nova->>k);
      END;
    END IF;
  END LOOP;

  SELECT impostos_venda_pct, comissao_venda_pct, provisao_garantia_pct, margem_alvo_pct
    INTO v_imp0, v_com0, v_gar0, v_margem0 FROM veic_config WHERE company_id = p_company_id;

  -- config nova: cada chave presente sobrepõe; ausente mantém a atual
  v_imp1    := COALESCE(public.fn_veic_num(p_config_nova->>'impostos_venda_pct'), v_imp0);
  v_com1    := COALESCE(public.fn_veic_num(p_config_nova->>'comissao_venda_pct'), v_com0);
  v_gar1    := COALESCE(public.fn_veic_num(p_config_nova->>'provisao_garantia_pct'), v_gar0);
  v_margem1 := COALESCE(public.fn_veic_num(p_config_nova->>'margem_alvo_pct'), v_margem0);
  v_enc0 := (COALESCE(v_imp0,0)+COALESCE(v_com0,0)+COALESCE(v_gar0,0))/100.0;
  v_enc1 := (COALESCE(v_imp1,0)+COALESCE(v_com1,0)+COALESCE(v_gar1,0))/100.0;

  WITH base AS (
    SELECT vv.id, vv.modelo, vv.placa,
      (COALESCE(vv.valor_aquisicao,0)
        + COALESCE((SELECT sum(c.valor) FROM veic_custo c WHERE c.veiculo_id=vv.id AND c.deleted_at IS NULL),0)
        + COALESCE((SELECT iv.previsao_total FROM insp_vistoria iv WHERE iv.alvo_tabela='veic_veiculo' AND iv.alvo_id=vv.id AND iv.situacao='concluida' ORDER BY iv.concluida_em DESC LIMIT 1),0)
      ) AS custo_total,
      COALESCE(vv.margem_alvo_pct, v_margem0) AS margem_veic0,
      COALESCE(vv.margem_alvo_pct, v_margem1) AS margem_veic1,
      vv.valor_aquisicao
    FROM veic_veiculo vv WHERE vv.company_id = p_company_id AND vv.deleted_at IS NULL
  ),
  calc AS (
    SELECT id, modelo, placa, custo_total,
      CASE WHEN COALESCE(valor_aquisicao,0) > 0 AND (1 - v_enc0 - COALESCE(margem_veic0,0)/100.0) > 0.0001
           THEN round(custo_total / (1 - v_enc0 - COALESCE(margem_veic0,0)/100.0), 2) END AS antes,
      CASE WHEN COALESCE(valor_aquisicao,0) > 0 AND (1 - v_enc1 - COALESCE(margem_veic1,0)/100.0) > 0.0001
           THEN round(custo_total / (1 - v_enc1 - COALESCE(margem_veic1,0)/100.0), 2) END AS depois
    FROM base
  )
  SELECT count(*), count(*) FILTER (WHERE antes IS DISTINCT FROM depois),
    (SELECT jsonb_agg(jsonb_build_object('modelo', modelo, 'placa', placa, 'antes', antes, 'depois', depois))
       FROM (SELECT modelo, placa, antes, depois FROM calc WHERE antes IS DISTINCT FROM depois LIMIT 3) e)
  INTO v_total, v_mudam, v_exemplos FROM calc;

  RETURN jsonb_build_object('ok', true, 'total_veiculos', v_total, 'mudam_preco_minimo', COALESCE(v_mudam,0),
    'exemplos', COALESCE(v_exemplos, '[]'::jsonb),
    'encargos_antes_pct', round(v_enc0*100,2), 'encargos_depois_pct', round(v_enc1*100,2),
    'margem_antes_pct', v_margem0, 'margem_depois_pct', v_margem1);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_veic_config_salvar(p_company_id uuid, p_dados jsonb, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_antes jsonb; v_depois jsonb;
  v_imp numeric; v_com numeric; v_gar numeric; v_margem numeric; v_sv int; v_sa int; v_vmodo text;
  v_autor uuid := auth.uid();  -- autoria pela sessão; nunca pelo p_user do cliente (CEO/RD)
  k text; v_tmp numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- #114 · valida TODOS os numéricos antes de gravar. Antes: o 1º bloco virava NULL em silêncio (e gravava
  -- nulo por cima, pois a chave presente é autoritativa) e o 2º UPDATE derrubava com "40.000,00".
  FOREACH k IN ARRAY ARRAY['impostos_venda_pct','comissao_venda_pct','provisao_garantia_pct','margem_alvo_pct',
      'semaforo_verde_ate_dias','semaforo_amarelo_ate_dias','vagas_operacionais','area_patio_m2','custo_fixo_mensal_manual',
      'taxa_capital_aa','floor_plan_taxa_aa','garantia_prazo_meses','meta_veiculos_mes','margem_minima_pct'] LOOP
    IF p_dados ? k THEN
      BEGIN v_tmp := public.fn_veic_num(p_dados->>k);
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido', 'campo', k, 'valor', p_dados->>k);
      END;
    END IF;
  END LOOP;

  SELECT to_jsonb(c) INTO v_antes FROM veic_config c WHERE company_id = p_company_id;

  v_imp    := public.fn_veic_num(p_dados->>'impostos_venda_pct');
  v_com    := public.fn_veic_num(p_dados->>'comissao_venda_pct');
  v_gar    := public.fn_veic_num(p_dados->>'provisao_garantia_pct');
  v_margem := public.fn_veic_num(p_dados->>'margem_alvo_pct');
  v_sv     := public.fn_veic_int(p_dados->>'semaforo_verde_ate_dias');
  v_sa     := public.fn_veic_int(p_dados->>'semaforo_amarelo_ate_dias');
  v_vmodo := CASE WHEN p_dados->>'vistoria_modo_padrao' IN ('rapida','completa') THEN p_dados->>'vistoria_modo_padrao' ELSE NULL END;

  INSERT INTO veic_config (company_id, semaforo_verde_ate_dias, semaforo_amarelo_ate_dias, margem_alvo_pct,
      impostos_venda_pct, comissao_venda_pct, provisao_garantia_pct, vistoria_modo_padrao, updated_at)
  VALUES (p_company_id, COALESCE(v_sv,30), COALESCE(v_sa,60), COALESCE(v_margem,20), v_imp, v_com, v_gar, COALESCE(v_vmodo,'rapida'), now())
  ON CONFLICT (company_id) DO UPDATE SET
    semaforo_verde_ate_dias   = COALESCE(v_sv, veic_config.semaforo_verde_ate_dias),
    semaforo_amarelo_ate_dias = COALESCE(v_sa, veic_config.semaforo_amarelo_ate_dias),
    margem_alvo_pct           = COALESCE(v_margem, veic_config.margem_alvo_pct),
    -- chave presente é autoritativa: um save parcial (ex.: só a marca d'água) NÃO zera impostos/comissão/garantia
    impostos_venda_pct        = CASE WHEN p_dados ? 'impostos_venda_pct'    THEN v_imp ELSE veic_config.impostos_venda_pct END,
    comissao_venda_pct        = CASE WHEN p_dados ? 'comissao_venda_pct'    THEN v_com ELSE veic_config.comissao_venda_pct END,
    provisao_garantia_pct     = CASE WHEN p_dados ? 'provisao_garantia_pct' THEN v_gar ELSE veic_config.provisao_garantia_pct END,
    vistoria_modo_padrao      = COALESCE(v_vmodo, veic_config.vistoria_modo_padrao),
    updated_at                = now();

  -- R2 + R8a: colunas por chave presente (presente → grava; ausente → mantém). Números por fn_veic_num/int.
  UPDATE veic_config SET
    vagas_operacionais      = CASE WHEN p_dados ? 'vagas_operacionais'      THEN GREATEST(public.fn_veic_int(p_dados->>'vagas_operacionais'), 0) ELSE vagas_operacionais END,
    area_patio_m2           = CASE WHEN p_dados ? 'area_patio_m2'           THEN public.fn_veic_num(p_dados->>'area_patio_m2') ELSE area_patio_m2 END,
    endereco_patio          = CASE WHEN p_dados ? 'endereco_patio'          THEN NULLIF(btrim(p_dados->>'endereco_patio'),'') ELSE endereco_patio END,
    custo_fixo_mensal_manual= CASE WHEN p_dados ? 'custo_fixo_mensal_manual' THEN GREATEST(public.fn_veic_num(p_dados->>'custo_fixo_mensal_manual'), 0) ELSE custo_fixo_mensal_manual END,
    contas_rateio           = CASE WHEN p_dados ? 'contas_rateio'           THEN (SELECT array_agg((x)::uuid) FROM jsonb_array_elements_text(COALESCE(p_dados->'contas_rateio','[]'::jsonb)) x) ELSE contas_rateio END,
    taxa_capital_aa         = CASE WHEN p_dados ? 'taxa_capital_aa'         THEN GREATEST(public.fn_veic_num(p_dados->>'taxa_capital_aa'), 0) ELSE taxa_capital_aa END,
    usa_floor_plan          = CASE WHEN p_dados ? 'usa_floor_plan'          THEN COALESCE((p_dados->>'usa_floor_plan')::boolean, false) ELSE usa_floor_plan END,
    floor_plan_banco        = CASE WHEN p_dados ? 'floor_plan_banco'        THEN NULLIF(btrim(p_dados->>'floor_plan_banco'),'') ELSE floor_plan_banco END,
    floor_plan_taxa_aa      = CASE WHEN p_dados ? 'floor_plan_taxa_aa'      THEN GREATEST(public.fn_veic_num(p_dados->>'floor_plan_taxa_aa'), 0) ELSE floor_plan_taxa_aa END,
    depreciacao_fonte       = CASE WHEN p_dados ? 'depreciacao_fonte'       THEN (CASE WHEN p_dados->>'depreciacao_fonte' IN ('fipe','curva_propria','nao_calcular') THEN p_dados->>'depreciacao_fonte' ELSE depreciacao_fonte END) ELSE depreciacao_fonte END,
    depreciacao_curva       = CASE WHEN p_dados ? 'depreciacao_curva'       THEN p_dados->'depreciacao_curva' ELSE depreciacao_curva END,
    garantia_prazo_meses    = CASE WHEN p_dados ? 'garantia_prazo_meses'    THEN GREATEST(public.fn_veic_int(p_dados->>'garantia_prazo_meses'), 0) ELSE garantia_prazo_meses END,
    comissao_base           = CASE WHEN p_dados ? 'comissao_base'           THEN (CASE WHEN p_dados->>'comissao_base' IN ('lucro_real','venda') THEN p_dados->>'comissao_base' ELSE comissao_base END) ELSE comissao_base END,
    meta_veiculos_mes       = CASE WHEN p_dados ? 'meta_veiculos_mes'       THEN GREATEST(public.fn_veic_int(p_dados->>'meta_veiculos_mes'), 0) ELSE meta_veiculos_mes END,
    margem_minima_pct       = CASE WHEN p_dados ? 'margem_minima_pct'       THEN GREATEST(public.fn_veic_num(p_dados->>'margem_minima_pct'), 0) ELSE margem_minima_pct END,
    -- R8a · marca d'água da loja
    logo_storage_path       = CASE WHEN p_dados ? 'logo_storage_path'       THEN NULLIF(btrim(p_dados->>'logo_storage_path'),'') ELSE logo_storage_path END,
    marca_dagua_ativa       = CASE WHEN p_dados ? 'marca_dagua_ativa'       THEN COALESCE((p_dados->>'marca_dagua_ativa')::boolean, true) ELSE marca_dagua_ativa END,
    updated_at = now()
  WHERE company_id = p_company_id;

  SELECT to_jsonb(c) INTO v_depois FROM veic_config c WHERE company_id = p_company_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, COALESCE(v_autor, p_user), 'veic_config', p_company_id::text, 'config_salvar', v_antes, v_depois);

  RETURN jsonb_build_object('ok', true, 'config', v_depois, 'carrego', fn_veic_carrego_parametros(p_company_id));
END $function$;

REVOKE ALL ON FUNCTION public.fn_veic_config_obter(uuid)                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_config_previa_efeito(uuid, jsonb)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_config_salvar(uuid, jsonb, uuid)      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_config_obter(uuid)               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_config_previa_efeito(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_config_salvar(uuid, jsonb, uuid)  TO authenticated, service_role;
