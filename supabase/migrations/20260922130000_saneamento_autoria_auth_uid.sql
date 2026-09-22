-- Saneamento · autoria por auth.uid() (não pelo p_user do cliente) — defeito recorrente (item 3, 22/09).
--
-- A autoria (created_by/updated_by/*_por/usuario_id) tem de vir da SESSÃO (auth.uid()), nunca de um
-- parâmetro passado pelo cliente (forjável). Sem sessão (service_role/interno) auth.uid() é NULL → grava
-- "sistema". A ASSINATURA das funções é preservada (p_user continua no argumento, apenas IGNORADO para
-- autoria) para não quebrar as telas que ainda o enviam. Fecha as duas primeiras do lote citadas pelo
-- Eng. Chefe (fn_veic_atualizar_dados, fn_veic_precificacao_salvar); as demais entram em lotes seguintes.
-- (fn_veic_precificacao_lote já usa auth.uid() desde o #1672.)
--
-- A trava de CI (scripts/check-fn-guards.ts) passa a reprovar migration NOVA que reincida no padrão.

-- ── fn_veic_atualizar_dados: autoria por auth.uid() ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_atualizar_dados(p_veiculo_id uuid, p_dados jsonb, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_autor uuid := auth.uid();  -- autoria pela sessão; NULL (service_role) = sistema
BEGIN
  SELECT company_id INTO v_company FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  IF (p_dados ? 'ncm') AND NULLIF(btrim(p_dados->>'ncm'),'') IS NOT NULL AND btrim(p_dados->>'ncm') !~ '^[0-9]{8}$' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ncm_invalido'); END IF;
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
    chassi         = CASE WHEN p_dados ? 'chassi'          THEN COALESCE(NULLIF(btrim(p_dados->>'chassi'),''), chassi) ELSE chassi END,
    cambio         = CASE WHEN p_dados ? 'cambio'          THEN NULLIF(btrim(p_dados->>'cambio'),'')          ELSE cambio END,
    potencia_cv    = CASE WHEN p_dados ? 'potencia_cv'     THEN NULLIF(p_dados->>'potencia_cv','')::numeric    ELSE potencia_cv END,
    cilindradas    = CASE WHEN p_dados ? 'cilindradas'     THEN NULLIF(p_dados->>'cilindradas','')::numeric    ELSE cilindradas END,
    portas         = CASE WHEN p_dados ? 'portas'          THEN NULLIF(p_dados->>'portas','')::int             ELSE portas END,
    ano_fabricacao = CASE WHEN p_dados ? 'ano_fabricacao'  THEN NULLIF(p_dados->>'ano_fabricacao','')::int     ELSE ano_fabricacao END,
    ano_modelo     = CASE WHEN p_dados ? 'ano_modelo'      THEN NULLIF(p_dados->>'ano_modelo','')::int         ELSE ano_modelo END,
    km_entrada     = CASE WHEN p_dados ? 'km_entrada'      THEN NULLIF(p_dados->>'km_entrada','')::numeric     ELSE km_entrada END,
    valor_aquisicao= CASE WHEN p_dados ? 'valor_aquisicao' THEN NULLIF(p_dados->>'valor_aquisicao','')::numeric ELSE valor_aquisicao END,
    ncm            = CASE WHEN p_dados ? 'ncm'             THEN NULLIF(btrim(p_dados->>'ncm'),'')              ELSE ncm END,
    lugares        = CASE WHEN p_dados ? 'lugares'         THEN NULLIF(p_dados->>'lugares','')::int            ELSE lugares END,
    valor_fipe     = CASE WHEN p_dados ? 'valor_fipe'      THEN NULLIF(p_dados->>'valor_fipe','')::numeric      ELSE valor_fipe END,
    valor_fipe_informado_em  = CASE WHEN p_dados ? 'valor_fipe' THEN now()     ELSE valor_fipe_informado_em END,
    valor_fipe_informado_por = CASE WHEN p_dados ? 'valor_fipe' THEN v_autor   ELSE valor_fipe_informado_por END,
    tipo               = CASE WHEN p_dados ? 'tipo'               THEN NULLIF(btrim(p_dados->>'tipo'),'')               ELSE tipo END,
    crlv_storage_path  = CASE WHEN p_dados ? 'crlv_storage_path'  THEN NULLIF(btrim(p_dados->>'crlv_storage_path'),'')  ELSE crlv_storage_path END,
    updated_by = v_autor, updated_at = now()
  WHERE id = p_veiculo_id;

  INSERT INTO veic_veiculo_evento(company_id, veiculo_id, tipo, descricao, usuario_id, payload)
  VALUES (v_company, p_veiculo_id, 'edicao', 'Dados do veículo atualizados', v_autor,
          jsonb_build_object('campos', (SELECT array_agg(k) FROM jsonb_object_keys(p_dados) k)));

  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_veic_atualizar_dados(uuid, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_veic_atualizar_dados(uuid, jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_atualizar_dados(uuid, jsonb, uuid) TO authenticated, service_role;

-- ── fn_veic_precificacao_salvar: autoria por auth.uid() ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_precificacao_salvar(p_veiculo_id uuid, p_dados jsonb, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v record; v_comp uuid; v_custos numeric; v_custo_base numeric; v_custo_total numeric;
  v_previsao numeric; v_imp numeric; v_com numeric; v_gar numeric;
  v_preco_venda numeric; v_margem numeric; v_preco_min numeric; v_soma_enc numeric; v_hist uuid;
  v_autor uuid := auth.uid();  -- autoria pela sessão; NULL (service_role) = sistema
BEGIN
  v_comp := public.fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT company_id, valor_aquisicao INTO v FROM veic_veiculo WHERE id = p_veiculo_id;

  BEGIN v_preco_venda := NULLIF(btrim(p_dados->>'preco_venda'),'')::numeric; EXCEPTION WHEN others THEN v_preco_venda := NULL; END;
  IF v_preco_venda IS NULL OR v_preco_venda <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'preco_venda_invalido'); END IF;
  BEGIN v_margem := NULLIF(btrim(p_dados->>'margem_alvo_pct'),'')::numeric; EXCEPTION WHEN others THEN v_margem := NULL; END;

  SELECT COALESCE(sum(c.valor),0) INTO v_custos FROM veic_custo c WHERE c.veiculo_id = p_veiculo_id AND c.deleted_at IS NULL;
  v_custo_base := COALESCE(v.valor_aquisicao,0) + v_custos;
  SELECT previsao_total INTO v_previsao FROM insp_vistoria
   WHERE alvo_tabela = 'veic_veiculo' AND alvo_id = p_veiculo_id AND situacao = 'concluida' ORDER BY concluida_em DESC LIMIT 1;
  v_custo_total := v_custo_base + COALESCE(v_previsao,0);
  SELECT impostos_venda_pct, comissao_venda_pct, provisao_garantia_pct INTO v_imp, v_com, v_gar FROM veic_config WHERE company_id = v.company_id;
  v_soma_enc := v_custo_total * (COALESCE(v_imp,0) + COALESCE(v_com,0) + COALESCE(v_gar,0))/100;
  v_preco_min := v_custo_total + v_soma_enc;

  UPDATE veic_veiculo
     SET preco_venda = v_preco_venda, preco_minimo = v_preco_min, margem_alvo_pct = v_margem,
         precificado_em = now(), precificado_por = v_autor, updated_at = now(), updated_by = v_autor
   WHERE id = p_veiculo_id;

  INSERT INTO veic_precificacao_hist (company_id, veiculo_id, preco_venda, preco_minimo, margem_alvo_pct,
      custo_base, previsao_gastos, impostos_pct, comissao_pct, premissas, observacao, criado_por)
  VALUES (v.company_id, p_veiculo_id, v_preco_venda, v_preco_min, v_margem, v_custo_base, v_previsao, v_imp, v_com,
      jsonb_build_object('impostos_pct', v_imp, 'comissao_pct', v_com, 'garantia_pct', v_gar,
        'custo_total', v_custo_total, 'tinha_vistoria', v_previsao IS NOT NULL),
      NULLIF(btrim(p_dados->>'observacao'),''), v_autor)
  RETURNING id INTO v_hist;

  RETURN jsonb_build_object('ok', true, 'preco_venda', v_preco_venda, 'preco_minimo', v_preco_min, 'hist_id', v_hist);
END $function$;

REVOKE ALL ON FUNCTION public.fn_veic_precificacao_salvar(uuid, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_veic_precificacao_salvar(uuid, jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_precificacao_salvar(uuid, jsonb, uuid) TO authenticated, service_role;
