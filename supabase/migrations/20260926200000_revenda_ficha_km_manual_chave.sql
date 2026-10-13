-- Revenda · ficha do veículo: KM, manual e chave reserva + especificação (chamados Alliance #26 #49 #143).
--
-- O cliente pediu 3 vezes (04/09, 11/09, 25/09) para trocar "Potência" por KM e "Cilindrada" por
-- Manual / Chave reserva, e um campo de especificação. A PS prometeu em 11/09 (#26) e nunca fez.
-- Potência e cilindradas NÃO saem do banco: são dados da nota (veicProd) e da sugestão de NCM de moto;
-- na tela passam para o bloco "Fiscal do veículo". A ficha principal mostra o que a revenda usa no dia a dia.
--
-- 1) veic_veiculo ganha tem_manual e tem_chave_reserva (nulo = não informado; nunca "não tem").
-- 2) fn_veic_atualizar_dados aceita km_atual, tem_manual, tem_chave_reserva e observacao (a especificação,
--    que já alimenta o texto do anúncio). Boolean aceita sim/não; valor fora disso volta valor_invalido.
-- 3) fn_veic_criar (caminho irmão, RD-71): trocava ::int/::numeric direto — "72.956,00" ou "2,4" davam
--    HTTP 400, e a tela mandava Number("72.956,00") = NaN = null (valor de aquisição perdido em silêncio).
--    Agora valida campo a campo com fn_veic_num/fn_veic_int e devolve ok:false + campo, como o atualizar.
-- Sem DML em dado de cliente: só colunas novas nulas e funções.

ALTER TABLE public.veic_veiculo
  ADD COLUMN IF NOT EXISTS tem_manual        boolean,
  ADD COLUMN IF NOT EXISTS tem_chave_reserva boolean;

COMMENT ON COLUMN public.veic_veiculo.tem_manual        IS 'Manual do proprietário presente (null = não informado)';
COMMENT ON COLUMN public.veic_veiculo.tem_chave_reserva IS 'Chave reserva presente (null = não informado)';

-- sim/não → boolean. '' ou nulo → NULL. Qualquer outra coisa → exceção (o chamador devolve valor_invalido).
CREATE OR REPLACE FUNCTION public.fn_veic_bool(p text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE v text := lower(btrim(coalesce(p, '')));
BEGIN
  IF v = '' THEN RETURN NULL; END IF;
  IF v IN ('sim', 's', 'true', 't', '1', 'yes') THEN RETURN true; END IF;
  IF v IN ('nao', 'não', 'n', 'false', 'f', '0', 'no') THEN RETURN false; END IF;
  RAISE EXCEPTION 'valor booleano inválido: %', p USING ERRCODE = '22P02';
END $function$;

CREATE OR REPLACE FUNCTION public.fn_veic_atualizar_dados(p_veiculo_id uuid, p_dados jsonb, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_autor uuid := auth.uid(); k text; v_tmp numeric; v_b boolean;
BEGIN
  SELECT company_id INTO v_company FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  IF (p_dados ? 'ncm') AND NULLIF(btrim(p_dados->>'ncm'),'') IS NOT NULL AND btrim(p_dados->>'ncm') !~ '^[0-9]{8}$' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ncm_invalido', 'campo', 'ncm'); END IF;
  IF (p_dados ? 'tipo') AND NULLIF(btrim(p_dados->>'tipo'),'') IS NOT NULL AND btrim(p_dados->>'tipo') NOT IN ('carro','moto','caminhao','maquina') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tipo_invalido', 'campo', 'tipo'); END IF;

  -- valida campo a campo ANTES do UPDATE: devolve ok:false + campo (nunca HTTP 400 por "72.956,00" ou "2,4")
  FOREACH k IN ARRAY ARRAY['potencia_cv','cilindradas','km_entrada','km_atual','valor_aquisicao','valor_fipe','portas','ano_fabricacao','ano_modelo','lugares'] LOOP
    IF p_dados ? k THEN
      BEGIN
        v_tmp := public.fn_veic_num(p_dados->>k);
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido', 'campo', k, 'valor', p_dados->>k);
      END;
    END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['tem_manual','tem_chave_reserva'] LOOP
    IF p_dados ? k THEN
      BEGIN
        v_b := public.fn_veic_bool(p_dados->>k);
      EXCEPTION WHEN invalid_text_representation THEN
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
    km_atual       = CASE WHEN p_dados ? 'km_atual'        THEN public.fn_veic_num(p_dados->>'km_atual')        ELSE km_atual END,
    tem_manual        = CASE WHEN p_dados ? 'tem_manual'        THEN public.fn_veic_bool(p_dados->>'tem_manual')        ELSE tem_manual END,
    tem_chave_reserva = CASE WHEN p_dados ? 'tem_chave_reserva' THEN public.fn_veic_bool(p_dados->>'tem_chave_reserva') ELSE tem_chave_reserva END,
    observacao     = CASE WHEN p_dados ? 'observacao'      THEN NULLIF(left(btrim(p_dados->>'observacao'), 2000),'') ELSE observacao END,
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

CREATE OR REPLACE FUNCTION public.fn_veic_criar(p_company_id uuid, p_veiculo jsonb, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_chassi text := NULLIF(trim(p_veiculo->>'chassi'), ''); v_autor uuid := auth.uid(); k text; v_tmp numeric; v_b boolean;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_chassi IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'chassi_obrigatorio'); END IF;
  IF EXISTS (SELECT 1 FROM veic_veiculo WHERE company_id = p_company_id AND chassi = v_chassi AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'chassi_ja_cadastrado'); END IF;

  -- RD-71 · mesmo anteparo do fn_veic_atualizar_dados: formato BR ("72.956,00", "2,4") aceito; lixo volta com o campo
  FOREACH k IN ARRAY ARRAY['ano_fabricacao','ano_modelo','potencia_cv','cilindradas','portas','km_entrada','km_atual','valor_aquisicao'] LOOP
    IF p_veiculo ? k THEN
      BEGIN
        v_tmp := public.fn_veic_num(p_veiculo->>k);
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido', 'campo', k, 'valor', p_veiculo->>k);
      END;
    END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['tem_manual','tem_chave_reserva'] LOOP
    IF p_veiculo ? k THEN
      BEGIN
        v_b := public.fn_veic_bool(p_veiculo->>k);
      EXCEPTION WHEN invalid_text_representation THEN
        RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido', 'campo', k, 'valor', p_veiculo->>k);
      END;
    END IF;
  END LOOP;

  -- colunas explícitas (situacao/data_entrada/ativo/created_at usam DEFAULT quando ausentes)
  INSERT INTO veic_veiculo (company_id, chassi, placa, renavam, marca, modelo, versao,
      ano_fabricacao, ano_modelo, cor, combustivel, potencia_cv, cilindradas, portas, cambio,
      km_entrada, km_atual, tem_manual, tem_chave_reserva, origem, data_entrada, fornecedor_id, fornecedor_nome, valor_aquisicao,
      foto_url, observacao, created_by, updated_by)
  VALUES (p_company_id, v_chassi, NULLIF(btrim(p_veiculo->>'placa'),''), NULLIF(btrim(p_veiculo->>'renavam'),''),
      NULLIF(btrim(p_veiculo->>'marca'),''), NULLIF(btrim(p_veiculo->>'modelo'),''), NULLIF(btrim(p_veiculo->>'versao'),''),
      public.fn_veic_int(p_veiculo->>'ano_fabricacao'), public.fn_veic_int(p_veiculo->>'ano_modelo'), NULLIF(btrim(p_veiculo->>'cor'),''),
      NULLIF(btrim(p_veiculo->>'combustivel'),''), public.fn_veic_num(p_veiculo->>'potencia_cv'), public.fn_veic_num(p_veiculo->>'cilindradas'),
      public.fn_veic_int(p_veiculo->>'portas'), NULLIF(btrim(p_veiculo->>'cambio'),''), public.fn_veic_num(p_veiculo->>'km_entrada'),
      public.fn_veic_num(p_veiculo->>'km_atual'), public.fn_veic_bool(p_veiculo->>'tem_manual'), public.fn_veic_bool(p_veiculo->>'tem_chave_reserva'),
      NULLIF(p_veiculo->>'origem',''),
      COALESCE((p_veiculo->>'data_entrada')::date, CURRENT_DATE), NULLIF(p_veiculo->>'fornecedor_id','')::uuid,
      p_veiculo->>'fornecedor_nome', public.fn_veic_num(p_veiculo->>'valor_aquisicao'),
      p_veiculo->>'foto_url', NULLIF(left(btrim(p_veiculo->>'observacao'), 2000),''), v_autor, v_autor)
  RETURNING id INTO v_id;

  INSERT INTO veic_veiculo_evento(company_id, veiculo_id, tipo, descricao, usuario_id, payload)
  VALUES (p_company_id, v_id, 'entrada', 'Veículo cadastrado', v_autor, jsonb_build_object('situacao', 'em_preparacao'));

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_veic_bool(text)                         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_atualizar_dados(uuid,jsonb,uuid)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_criar(uuid,jsonb,uuid)             FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_bool(text)                       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_atualizar_dados(uuid,jsonb,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_criar(uuid,jsonb,uuid)           TO authenticated, service_role;
