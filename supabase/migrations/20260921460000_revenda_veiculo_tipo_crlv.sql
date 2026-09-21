-- Revenda · R7b (Ficha técnica, T5) — tipo do veículo + CRLV por veículo.
--
-- Tela 5 (Ficha técnica) precisa do TIPO (carro/moto/caminhão/máquina) — que também alimenta a sugestão
-- de NCM (item 2c-c, fn_veic_ncm_sugerido/fn_veic_veiculo_fiscal recebem o tipo) — e do CRLV do veículo
-- (documento; caminho no bucket privado, nunca a URL pública). Aditivo (RD-55). Campo vazio = não_configurado.

ALTER TABLE public.veic_veiculo ADD COLUMN IF NOT EXISTS tipo text;
ALTER TABLE public.veic_veiculo ADD COLUMN IF NOT EXISTS crlv_storage_path text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='veic_veiculo_tipo_chk') THEN
    ALTER TABLE public.veic_veiculo ADD CONSTRAINT veic_veiculo_tipo_chk
      CHECK (tipo IS NULL OR tipo IN ('carro','moto','caminhao','maquina'));
  END IF;
END $$;

-- fn_veic_atualizar_dados: passa a persistir tipo (validado) e crlv_storage_path, além dos campos do 2c-c.
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
  -- tipo, quando presente e não-vazio, precisa ser um dos aceitos.
  IF (p_dados ? 'tipo') AND NULLIF(btrim(p_dados->>'tipo'),'') IS NOT NULL AND btrim(p_dados->>'tipo') NOT IN ('carro','moto','caminhao','maquina') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tipo_invalido'); END IF;

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
    -- R7b: tipo (carro/moto/caminhao/maquina) e CRLV (caminho no bucket privado)
    tipo               = CASE WHEN p_dados ? 'tipo'               THEN NULLIF(btrim(p_dados->>'tipo'),'')               ELSE tipo END,
    crlv_storage_path  = CASE WHEN p_dados ? 'crlv_storage_path'  THEN NULLIF(btrim(p_dados->>'crlv_storage_path'),'')  ELSE crlv_storage_path END,
    updated_by = p_user, updated_at = now()
  WHERE id = p_veiculo_id;

  INSERT INTO veic_veiculo_evento(company_id, veiculo_id, tipo, descricao, usuario_id, payload)
  VALUES (v_company, p_veiculo_id, 'edicao', 'Dados do veículo atualizados', p_user,
          jsonb_build_object('campos', (SELECT array_agg(k) FROM jsonb_object_keys(p_dados) k)));

  RETURN jsonb_build_object('ok', true);
END $function$;
