-- Chamados Alliance #114 (C) e #140/#141/#49 (B) · contexto 8304b8a3 · Fase 3 Saneamento
-- (versão 20260925233000: a 230000 já é do hotfix do importador #1804 — versão no ledger tem de ser única)
-- C) fn_veic_config_obter: text[] || 'literal' => 22P02 malformed array literal (quebrava toda empresa com config incompleta)
-- B) fn_veic_atualizar_dados: aceita formato brasileiro e devolve ok:false+campo em vez de HTTP 400

-- ---------- helpers de número (formato BR) ----------
CREATE OR REPLACE FUNCTION public.fn_veic_num(p text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text := btrim(coalesce(p, ''));
BEGIN
  IF s = '' THEN RETURN NULL; END IF;
  s := regexp_replace(s, '[^0-9,.\-]', '', 'g');                 -- tira "R$", espaços, "cv", "cc", "portas"
  IF s = '' OR s IN ('-', '.', ',') THEN
    RAISE EXCEPTION USING ERRCODE = '22P02', MESSAGE = 'numero invalido: ' || coalesce(p, '');
  END IF;
  IF position(',' IN s) > 0 THEN
    s := replace(replace(s, '.', ''), ',', '.');                 -- 72.956,00 -> 72956.00 · 2,4 -> 2.4
  ELSIF s ~ '^-?[0-9]{1,3}(\.[0-9]{3})+$' THEN
    s := replace(s, '.', '');                                    -- 72.956 -> 72956 (ponto de milhar)
  END IF;                                                        -- 1.6 continua 1.6
  RETURN s::numeric;
END $$;

CREATE OR REPLACE FUNCTION public.fn_veic_int(p text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT round(public.fn_veic_num(p))::int
$$;

-- ---------- C) fn_veic_config_obter ----------
CREATE OR REPLACE FUNCTION public.fn_veic_config_obter(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v record; v_falta text[] := ARRAY[]::text[];
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT * INTO v FROM veic_config WHERE company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'existe', false,
      'falta', ARRAY['estrutura','custo_fixo','capital','margem','impostos','depreciacao','garantia','comissao','meta']::text[]);
  END IF;

  -- array_append em vez de "|| 'literal'": com text[] o Postgres lia 'impostos' como literal de array e quebrava (22P02)
  IF COALESCE(v.vagas_operacionais,0) <= 0 THEN v_falta := array_append(v_falta, 'estrutura'); END IF;
  IF v.custo_fixo_mensal_manual IS NULL AND (v.contas_rateio IS NULL OR array_length(v.contas_rateio,1) IS NULL) THEN v_falta := array_append(v_falta, 'custo_fixo'); END IF;
  IF v.taxa_capital_aa IS NULL THEN v_falta := array_append(v_falta, 'capital'); END IF;
  IF v.margem_alvo_pct IS NULL THEN v_falta := array_append(v_falta, 'margem'); END IF;
  IF v.impostos_venda_pct IS NULL OR v.comissao_venda_pct IS NULL OR v.provisao_garantia_pct IS NULL THEN v_falta := array_append(v_falta, 'impostos'); END IF;
  IF v.depreciacao_fonte IS NULL THEN v_falta := array_append(v_falta, 'depreciacao'); END IF;
  IF v.garantia_prazo_meses IS NULL THEN v_falta := array_append(v_falta, 'garantia'); END IF;
  IF v.comissao_base IS NULL THEN v_falta := array_append(v_falta, 'comissao'); END IF;
  IF v.meta_veiculos_mes IS NULL THEN v_falta := array_append(v_falta, 'meta'); END IF;

  RETURN jsonb_build_object('ok', true, 'existe', true, 'falta', v_falta, 'config', to_jsonb(v),
    'carrego', fn_veic_carrego_parametros(p_company_id));
END $function$;

-- ---------- B) fn_veic_atualizar_dados ----------
CREATE OR REPLACE FUNCTION public.fn_veic_atualizar_dados(p_veiculo_id uuid, p_dados jsonb, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_company uuid; v_autor uuid := auth.uid(); k text; v_tmp numeric;
BEGIN
  SELECT company_id INTO v_company FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  IF (p_dados ? 'ncm') AND NULLIF(btrim(p_dados->>'ncm'),'') IS NOT NULL AND btrim(p_dados->>'ncm') !~ '^[0-9]{8}$' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ncm_invalido', 'campo', 'ncm'); END IF;
  IF (p_dados ? 'tipo') AND NULLIF(btrim(p_dados->>'tipo'),'') IS NOT NULL AND btrim(p_dados->>'tipo') NOT IN ('carro','moto','caminhao','maquina') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tipo_invalido', 'campo', 'tipo'); END IF;

  -- valida campo a campo ANTES do UPDATE: devolve ok:false + campo (nunca mais HTTP 400 por "72.956,00" ou "2,4")
  FOREACH k IN ARRAY ARRAY['potencia_cv','cilindradas','km_entrada','valor_aquisicao','valor_fipe','portas','ano_fabricacao','ano_modelo','lugares'] LOOP
    IF p_dados ? k THEN
      BEGIN
        v_tmp := public.fn_veic_num(p_dados->>k);
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido', 'campo', k, 'valor', p_dados->>k);
      END;
    END IF;
  END LOOP;

  UPDATE veic_veiculo SET
    marca          = COALESCE(NULLIF(btrim(p_dados->>'marca'),''), marca),
    modelo         = COALESCE(NULLIF(btrim(p_dados->>'modelo'),''), modelo),
    versao         = CASE WHEN p_dados ? 'versao'          THEN NULLIF(btrim(p_dados->>'versao'),'')          ELSE versao END,
    cor            = CASE WHEN p_dados ? 'cor'             THEN NULLIF(btrim(p_dados->>'cor'),'')             ELSE cor END,
    combustivel    = CASE WHEN p_dados ? 'combustivel'     THEN NULLIF(btrim(p_dados->>'combustivel'),'')     ELSE combustivel END,
    placa          = CASE WHEN p_dados ? 'placa'           THEN NULLIF(btrim(p_dados->>'placa'),'')           ELSE placa END,
    renavam        = CASE WHEN p_dados ? 'renavam'         THEN NULLIF(btrim(p_dados->>'renavam'),'')         ELSE renavam END,
    chassi         = CASE WHEN p_dados ? 'chassi'          THEN COALESCE(NULLIF(btrim(p_dados->>'chassi'),''), chassi) ELSE chassi END,
    cambio         = CASE WHEN p_dados ? 'cambio'          THEN NULLIF(btrim(p_dados->>'cambio'),'')          ELSE cambio END,
    potencia_cv    = CASE WHEN p_dados ? 'potencia_cv'     THEN public.fn_veic_num(p_dados->>'potencia_cv')     ELSE potencia_cv END,
    cilindradas    = CASE WHEN p_dados ? 'cilindradas'     THEN public.fn_veic_num(p_dados->>'cilindradas')     ELSE cilindradas END,
    portas         = CASE WHEN p_dados ? 'portas'          THEN public.fn_veic_int(p_dados->>'portas')          ELSE portas END,
    ano_fabricacao = CASE WHEN p_dados ? 'ano_fabricacao'  THEN public.fn_veic_int(p_dados->>'ano_fabricacao')  ELSE ano_fabricacao END,
    ano_modelo     = CASE WHEN p_dados ? 'ano_modelo'      THEN public.fn_veic_int(p_dados->>'ano_modelo')      ELSE ano_modelo END,
    km_entrada     = CASE WHEN p_dados ? 'km_entrada'      THEN public.fn_veic_num(p_dados->>'km_entrada')      ELSE km_entrada END,
    valor_aquisicao= CASE WHEN p_dados ? 'valor_aquisicao' THEN public.fn_veic_num(p_dados->>'valor_aquisicao') ELSE valor_aquisicao END,
    ncm            = CASE WHEN p_dados ? 'ncm'             THEN NULLIF(btrim(p_dados->>'ncm'),'')              ELSE ncm END,
    lugares        = CASE WHEN p_dados ? 'lugares'         THEN public.fn_veic_int(p_dados->>'lugares')         ELSE lugares END,
    valor_fipe     = CASE WHEN p_dados ? 'valor_fipe'      THEN public.fn_veic_num(p_dados->>'valor_fipe')      ELSE valor_fipe END,
    valor_fipe_informado_em  = CASE WHEN p_dados ? 'valor_fipe' THEN now()     ELSE valor_fipe_informado_em END,
    valor_fipe_informado_por = CASE WHEN p_dados ? 'valor_fipe' THEN v_autor   ELSE valor_fipe_informado_por END,
    tipo               = CASE WHEN p_dados ? 'tipo'               THEN NULLIF(btrim(p_dados->>'tipo'),'')               ELSE tipo END,
    crlv_storage_path  = CASE WHEN p_dados ? 'crlv_storage_path'  THEN NULLIF(btrim(p_dados->>'crlv_storage_path'),'')  ELSE crlv_storage_path END,
    updated_by = v_autor, updated_at = now()
  WHERE id = p_veiculo_id;

  INSERT INTO veic_veiculo_evento(company_id, veiculo_id, tipo, descricao, usuario_id, payload)
  VALUES (v_company, p_veiculo_id, 'edicao', 'Dados do veículo atualizados', v_autor,
          jsonb_build_object('campos', (SELECT array_agg(k2) FROM jsonb_object_keys(p_dados) k2)));

  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  -- último anteparo: o cliente recebe uma resposta legível, nunca um HTTP 400 mudo
  RETURN jsonb_build_object('ok', false, 'erro', 'falha_ao_salvar', 'sqlstate', SQLSTATE, 'mensagem', SQLERRM);
END $function$;

-- Guarda padrão (check-fn-guards): SECURITY DEFINER sem anon; autoria por auth.uid() já no corpo.
REVOKE ALL ON FUNCTION public.fn_veic_config_obter(uuid)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_atualizar_dados(uuid,jsonb,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_config_obter(uuid)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_atualizar_dados(uuid,jsonb,uuid) TO authenticated, service_role;
