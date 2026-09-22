-- R8a · Fotos, capa e marca d'água da loja (Revenda / Onda 8).
-- 1) veic_config ganha o logo da loja + toggle de marca d'água (configurável na "Configuração da garagem").
-- 2) fn_veic_config_salvar passa a aceitar essas duas chaves (chave presente é autoritativa) e grava a
--    autoria do audit por auth.uid() (não mais por p_user do cliente).
-- 3) Saneamento (RD-65/CEO): as 4 fn_veic_foto_* gravavam updated_by/created_by a partir do p_user do
--    CLIENTE (autoria forjável) e estavam abertas ao anon. Passam a gravar autoria por auth.uid()
--    (mantendo p_user na assinatura, ignorado) e a REVOKE anon. Nenhuma regra de negócio muda.

-- ── 1) colunas de marca d'água ──────────────────────────────────────────────
ALTER TABLE public.veic_config
  ADD COLUMN IF NOT EXISTS logo_storage_path text,
  ADD COLUMN IF NOT EXISTS marca_dagua_ativa boolean NOT NULL DEFAULT true;

-- ── 2) fn_veic_config_salvar: aceita logo_storage_path + marca_dagua_ativa; autoria por auth.uid() ──
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
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT to_jsonb(c) INTO v_antes FROM veic_config c WHERE company_id = p_company_id;

  -- numéricos com guarda (negativo/inválido → NULL, não grava lixo)
  BEGIN v_imp := NULLIF(btrim(p_dados->>'impostos_venda_pct'),'')::numeric; EXCEPTION WHEN others THEN v_imp := NULL; END;
  BEGIN v_com := NULLIF(btrim(p_dados->>'comissao_venda_pct'),'')::numeric; EXCEPTION WHEN others THEN v_com := NULL; END;
  BEGIN v_gar := NULLIF(btrim(p_dados->>'provisao_garantia_pct'),'')::numeric; EXCEPTION WHEN others THEN v_gar := NULL; END;
  BEGIN v_margem := NULLIF(btrim(p_dados->>'margem_alvo_pct'),'')::numeric; EXCEPTION WHEN others THEN v_margem := NULL; END;
  BEGIN v_sv := NULLIF(btrim(p_dados->>'semaforo_verde_ate_dias'),'')::int; EXCEPTION WHEN others THEN v_sv := NULL; END;
  BEGIN v_sa := NULLIF(btrim(p_dados->>'semaforo_amarelo_ate_dias'),'')::int; EXCEPTION WHEN others THEN v_sa := NULL; END;
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

  -- R2 + R8a: colunas por chave presente (presente → grava; ausente → mantém).
  UPDATE veic_config SET
    vagas_operacionais      = CASE WHEN p_dados ? 'vagas_operacionais'      THEN GREATEST(NULLIF(p_dados->>'vagas_operacionais','')::int, 0) ELSE vagas_operacionais END,
    area_patio_m2           = CASE WHEN p_dados ? 'area_patio_m2'           THEN NULLIF(p_dados->>'area_patio_m2','')::numeric ELSE area_patio_m2 END,
    endereco_patio          = CASE WHEN p_dados ? 'endereco_patio'          THEN NULLIF(btrim(p_dados->>'endereco_patio'),'') ELSE endereco_patio END,
    custo_fixo_mensal_manual= CASE WHEN p_dados ? 'custo_fixo_mensal_manual' THEN GREATEST(NULLIF(p_dados->>'custo_fixo_mensal_manual','')::numeric, 0) ELSE custo_fixo_mensal_manual END,
    contas_rateio           = CASE WHEN p_dados ? 'contas_rateio'           THEN (SELECT array_agg((x)::uuid) FROM jsonb_array_elements_text(COALESCE(p_dados->'contas_rateio','[]'::jsonb)) x) ELSE contas_rateio END,
    taxa_capital_aa         = CASE WHEN p_dados ? 'taxa_capital_aa'         THEN GREATEST(NULLIF(p_dados->>'taxa_capital_aa','')::numeric, 0) ELSE taxa_capital_aa END,
    usa_floor_plan          = CASE WHEN p_dados ? 'usa_floor_plan'          THEN COALESCE((p_dados->>'usa_floor_plan')::boolean, false) ELSE usa_floor_plan END,
    floor_plan_banco        = CASE WHEN p_dados ? 'floor_plan_banco'        THEN NULLIF(btrim(p_dados->>'floor_plan_banco'),'') ELSE floor_plan_banco END,
    floor_plan_taxa_aa      = CASE WHEN p_dados ? 'floor_plan_taxa_aa'      THEN GREATEST(NULLIF(p_dados->>'floor_plan_taxa_aa','')::numeric, 0) ELSE floor_plan_taxa_aa END,
    depreciacao_fonte       = CASE WHEN p_dados ? 'depreciacao_fonte'       THEN (CASE WHEN p_dados->>'depreciacao_fonte' IN ('fipe','curva_propria','nao_calcular') THEN p_dados->>'depreciacao_fonte' ELSE depreciacao_fonte END) ELSE depreciacao_fonte END,
    depreciacao_curva       = CASE WHEN p_dados ? 'depreciacao_curva'       THEN p_dados->'depreciacao_curva' ELSE depreciacao_curva END,
    garantia_prazo_meses    = CASE WHEN p_dados ? 'garantia_prazo_meses'    THEN GREATEST(NULLIF(p_dados->>'garantia_prazo_meses','')::int, 0) ELSE garantia_prazo_meses END,
    comissao_base           = CASE WHEN p_dados ? 'comissao_base'           THEN (CASE WHEN p_dados->>'comissao_base' IN ('lucro_real','venda') THEN p_dados->>'comissao_base' ELSE comissao_base END) ELSE comissao_base END,
    meta_veiculos_mes       = CASE WHEN p_dados ? 'meta_veiculos_mes'       THEN GREATEST(NULLIF(p_dados->>'meta_veiculos_mes','')::int, 0) ELSE meta_veiculos_mes END,
    margem_minima_pct       = CASE WHEN p_dados ? 'margem_minima_pct'       THEN GREATEST(NULLIF(p_dados->>'margem_minima_pct','')::numeric, 0) ELSE margem_minima_pct END,
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

-- ── 3) saneamento das fn_veic_foto_* — autoria por auth.uid() (p_user fica na assinatura, ignorado) ──
CREATE OR REPLACE FUNCTION public.fn_veic_foto_registrar(p_veiculo_id uuid, p_storage_path text, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_id uuid; v_qtd int; v_ordem int; v_autor uuid := auth.uid();
BEGIN
  v_company := public.fn_veic_acesso(p_veiculo_id);
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF NULLIF(btrim(p_storage_path),'') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'storage_path_obrigatorio'); END IF;
  SELECT count(*), COALESCE(max(ordem)+1,0) INTO v_qtd, v_ordem FROM veic_veiculo_foto WHERE veiculo_id = p_veiculo_id;
  INSERT INTO veic_veiculo_foto (veiculo_id, company_id, storage_path, principal, ordem, created_by)
  VALUES (p_veiculo_id, v_company, p_storage_path, v_qtd = 0, v_ordem, v_autor)
  RETURNING id INTO v_id;
  IF v_qtd = 0 THEN
    UPDATE veic_veiculo SET foto_url = p_storage_path, updated_at = now(), updated_by = v_autor WHERE id = p_veiculo_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'principal', v_qtd = 0);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_veic_foto_principal(p_foto_id uuid, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_veiculo uuid; v_path text; v_company uuid; v_autor uuid := auth.uid();
BEGIN
  SELECT veiculo_id, storage_path INTO v_veiculo, v_path FROM veic_veiculo_foto WHERE id = p_foto_id;
  IF v_veiculo IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'foto_nao_encontrada'); END IF;
  v_company := public.fn_veic_acesso(v_veiculo);
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE veic_veiculo_foto SET principal = false WHERE veiculo_id = v_veiculo AND principal;
  UPDATE veic_veiculo_foto SET principal = true WHERE id = p_foto_id;
  UPDATE veic_veiculo SET foto_url = v_path, updated_at = now(), updated_by = v_autor WHERE id = v_veiculo;
  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_veic_foto_remover(p_foto_id uuid, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_veiculo uuid; v_era_principal boolean; v_company uuid; v_nova_path text; v_nova_id uuid; v_removida_path text; v_autor uuid := auth.uid();
BEGIN
  SELECT veiculo_id, principal, storage_path INTO v_veiculo, v_era_principal, v_removida_path FROM veic_veiculo_foto WHERE id = p_foto_id;
  IF v_veiculo IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'foto_nao_encontrada'); END IF;
  v_company := public.fn_veic_acesso(v_veiculo);
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  DELETE FROM veic_veiculo_foto WHERE id = p_foto_id;
  IF v_era_principal THEN
    SELECT id, storage_path INTO v_nova_id, v_nova_path FROM veic_veiculo_foto
      WHERE veiculo_id = v_veiculo ORDER BY ordem LIMIT 1;
    IF v_nova_id IS NOT NULL THEN
      UPDATE veic_veiculo_foto SET principal = true WHERE id = v_nova_id;
      UPDATE veic_veiculo SET foto_url = v_nova_path, updated_at = now(), updated_by = v_autor WHERE id = v_veiculo;
    ELSE
      UPDATE veic_veiculo SET foto_url = NULL, updated_at = now(), updated_by = v_autor WHERE id = v_veiculo;
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'storage_path_removido', v_removida_path);
END $function$;

-- reordenar não grava autoria; recriada só para carregar o REVOKE anon junto (idêntica no corpo).
CREATE OR REPLACE FUNCTION public.fn_veic_foto_reordenar(p_veiculo_id uuid, p_ordens jsonb, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_item jsonb;
BEGIN
  v_company := public.fn_veic_acesso(p_veiculo_id);
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_ordens) LOOP
    UPDATE veic_veiculo_foto SET ordem = (v_item->>'ordem')::int
     WHERE id = (v_item->>'id')::uuid AND veiculo_id = p_veiculo_id;
  END LOOP;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- ── REVOKE anon + GRANT explícito (CEO: nenhuma SECURITY DEFINER aberta ao anon) ──
REVOKE ALL ON FUNCTION public.fn_veic_config_salvar(uuid,jsonb,uuid)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_foto_registrar(uuid,text,uuid)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_foto_principal(uuid,uuid)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_foto_remover(uuid,uuid)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_foto_reordenar(uuid,jsonb,uuid)      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_config_salvar(uuid,jsonb,uuid)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_foto_registrar(uuid,text,uuid)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_foto_principal(uuid,uuid)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_foto_remover(uuid,uuid)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_foto_reordenar(uuid,jsonb,uuid)    TO authenticated, service_role;
