-- Revenda · item 2c-c — FIPE e NCM na ficha do veículo.
--
-- O #1654 criou veic_veiculo.valor_fipe (+ informado_em/por), ncm e lugares, e a tabela de NCM por faixa.
-- Aqui o editor genérico (fn_veic_atualizar_dados) passa a PERSISTIR FIPE (carimbando quem/quando),
-- NCM (8 dígitos ou vazio) e lugares; e um obter leve (fn_veic_veiculo_fiscal) devolve o estado + o NCM
-- SUGERIDO pela tabela (fn_veic_ncm_sugerido) e o ncm_padrao do perfil. Genérico, por empresa (RD-65).
-- Aditivo (RD-55, CREATE OR REPLACE). Campo vazio = não_configurado (RD-51).

CREATE OR REPLACE FUNCTION public.fn_veic_atualizar_dados(p_veiculo_id uuid, p_dados jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- NCM, quando presente e não-vazio, precisa ter 8 dígitos (a NF-e rejeita 6+00).
  IF (p_dados ? 'ncm') AND NULLIF(btrim(p_dados->>'ncm'),'') IS NOT NULL AND btrim(p_dados->>'ncm') !~ '^[0-9]{8}$' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ncm_invalido'); END IF;

  UPDATE veic_veiculo SET
    marca          = COALESCE(NULLIF(btrim(p_dados->>'marca'),''), marca),
    modelo         = COALESCE(NULLIF(btrim(p_dados->>'modelo'),''), modelo),
    versao         = CASE WHEN p_dados ? 'versao'          THEN NULLIF(btrim(p_dados->>'versao'),'')          ELSE versao END,
    cor            = CASE WHEN p_dados ? 'cor'             THEN NULLIF(btrim(p_dados->>'cor'),'')             ELSE cor END,
    combustivel    = CASE WHEN p_dados ? 'combustivel'     THEN NULLIF(btrim(p_dados->>'combustivel'),'')     ELSE combustivel END,
    placa          = CASE WHEN p_dados ? 'placa'           THEN NULLIF(btrim(p_dados->>'placa'),'')           ELSE placa END,
    renavam        = CASE WHEN p_dados ? 'renavam'         THEN NULLIF(btrim(p_dados->>'renavam'),'')         ELSE renavam END,
    cambio         = CASE WHEN p_dados ? 'cambio'          THEN NULLIF(btrim(p_dados->>'cambio'),'')          ELSE cambio END,
    potencia_cv    = CASE WHEN p_dados ? 'potencia_cv'     THEN NULLIF(p_dados->>'potencia_cv','')::numeric    ELSE potencia_cv END,
    cilindradas    = CASE WHEN p_dados ? 'cilindradas'     THEN NULLIF(p_dados->>'cilindradas','')::numeric    ELSE cilindradas END,
    portas         = CASE WHEN p_dados ? 'portas'          THEN NULLIF(p_dados->>'portas','')::int             ELSE portas END,
    ano_fabricacao = CASE WHEN p_dados ? 'ano_fabricacao'  THEN NULLIF(p_dados->>'ano_fabricacao','')::int     ELSE ano_fabricacao END,
    ano_modelo     = CASE WHEN p_dados ? 'ano_modelo'      THEN NULLIF(p_dados->>'ano_modelo','')::int         ELSE ano_modelo END,
    km_entrada     = CASE WHEN p_dados ? 'km_entrada'      THEN NULLIF(p_dados->>'km_entrada','')::numeric     ELSE km_entrada END,
    valor_aquisicao= CASE WHEN p_dados ? 'valor_aquisicao' THEN NULLIF(p_dados->>'valor_aquisicao','')::numeric ELSE valor_aquisicao END,
    -- item 2c-c: FIPE (carimba quem/quando ao informar), NCM (8 díg.) e lugares
    ncm            = CASE WHEN p_dados ? 'ncm'             THEN NULLIF(btrim(p_dados->>'ncm'),'')              ELSE ncm END,
    lugares        = CASE WHEN p_dados ? 'lugares'         THEN NULLIF(p_dados->>'lugares','')::int            ELSE lugares END,
    valor_fipe     = CASE WHEN p_dados ? 'valor_fipe'      THEN NULLIF(p_dados->>'valor_fipe','')::numeric      ELSE valor_fipe END,
    valor_fipe_informado_em  = CASE WHEN p_dados ? 'valor_fipe' THEN now()   ELSE valor_fipe_informado_em END,
    valor_fipe_informado_por = CASE WHEN p_dados ? 'valor_fipe' THEN p_user  ELSE valor_fipe_informado_por END,
    updated_by = p_user, updated_at = now()
  WHERE id = p_veiculo_id;

  INSERT INTO veic_veiculo_evento(company_id, veiculo_id, tipo, descricao, usuario_id, payload)
  VALUES (v_company, p_veiculo_id, 'edicao', 'Dados do veículo atualizados', p_user,
          jsonb_build_object('campos', (SELECT array_agg(k) FROM jsonb_object_keys(p_dados) k)));

  RETURN jsonb_build_object('ok', true);
END $function$;

-- Estado fiscal do veículo + NCM sugerido pela tabela (RD-65) + ncm_padrão do perfil aprovado.
CREATE OR REPLACE FUNCTION public.fn_veic_veiculo_fiscal(p_veiculo_id uuid, p_tipo text DEFAULT 'carro')
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v record; v_sug text; v_padrao text;
BEGIN
  SELECT company_id, combustivel, cilindradas, lugares, ncm, valor_fipe, valor_fipe_informado_em
    INTO v FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF v.company_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;
  IF NOT (v.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  v_sug := fn_veic_ncm_sugerido(COALESCE(NULLIF(btrim(p_tipo),''),'carro'), v.combustivel, v.cilindradas, v.lugares);
  SELECT ncm_padrao INTO v_padrao FROM veic_perfil_fiscal
   WHERE company_id = v.company_id AND status = 'aprovado' ORDER BY versao DESC LIMIT 1;

  RETURN jsonb_build_object('ok', true,
    'valor_fipe', v.valor_fipe, 'valor_fipe_informado_em', v.valor_fipe_informado_em,
    'ncm', v.ncm, 'lugares', v.lugares, 'combustivel', v.combustivel, 'cilindradas', v.cilindradas,
    'ncm_sugerido', v_sug, 'ncm_padrao', v_padrao,
    'ncm_status', CASE WHEN NULLIF(btrim(COALESCE(v.ncm,'')),'') IS NOT NULL THEN 'informado'
                       WHEN v_sug IS NOT NULL THEN 'sugerido'
                       WHEN v_padrao IS NOT NULL THEN 'padrao' ELSE 'nao_configurado' END);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_veic_veiculo_fiscal(uuid, text) TO authenticated, service_role;
