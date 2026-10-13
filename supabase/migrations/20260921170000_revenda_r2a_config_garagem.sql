-- Revenda R2a · Configuração da garagem (Documento Vivo V8, Tela 2) — banco + funções.
-- ADITIVA (RD-55): só ACRESCENTA colunas em veic_config, nada é convertido. Guard RD-51: sem config, os
-- indicadores de carrego dizem 'nao_configurado' — nunca R$ 0. Prévia obrigatória antes de salvar (RD-70).

-- ── Colunas novas (aditiva) ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.veic_config
  ADD COLUMN IF NOT EXISTS vagas_operacionais     integer,
  ADD COLUMN IF NOT EXISTS area_patio_m2           numeric,
  ADD COLUMN IF NOT EXISTS endereco_patio          text,
  ADD COLUMN IF NOT EXISTS contas_rateio           uuid[],
  ADD COLUMN IF NOT EXISTS custo_fixo_mensal_manual numeric,
  ADD COLUMN IF NOT EXISTS taxa_capital_aa         numeric DEFAULT 15,   -- ~1,2% a.m. (complemento CEO)
  ADD COLUMN IF NOT EXISTS usa_floor_plan          boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS floor_plan_banco        text,
  ADD COLUMN IF NOT EXISTS floor_plan_taxa_aa      numeric,
  ADD COLUMN IF NOT EXISTS depreciacao_fonte       text DEFAULT 'nao_calcular',
  ADD COLUMN IF NOT EXISTS depreciacao_curva       jsonb,
  ADD COLUMN IF NOT EXISTS garantia_prazo_meses    integer,
  ADD COLUMN IF NOT EXISTS comissao_base           text,
  ADD COLUMN IF NOT EXISTS meta_veiculos_mes       integer,
  ADD COLUMN IF NOT EXISTS margem_minima_pct       numeric;

-- backfill dos defaults nas linhas existentes (aditivo, não converte nada)
UPDATE public.veic_config SET taxa_capital_aa = 15 WHERE taxa_capital_aa IS NULL;
UPDATE public.veic_config SET depreciacao_fonte = 'nao_calcular' WHERE depreciacao_fonte IS NULL;
UPDATE public.veic_config SET usa_floor_plan = false WHERE usa_floor_plan IS NULL;

ALTER TABLE public.veic_config DROP CONSTRAINT IF EXISTS veic_config_depreciacao_fonte_chk;
ALTER TABLE public.veic_config ADD CONSTRAINT veic_config_depreciacao_fonte_chk
  CHECK (depreciacao_fonte IS NULL OR depreciacao_fonte IN ('fipe','curva_propria','nao_calcular'));
ALTER TABLE public.veic_config DROP CONSTRAINT IF EXISTS veic_config_comissao_base_chk;
ALTER TABLE public.veic_config ADD CONSTRAINT veic_config_comissao_base_chk
  CHECK (comissao_base IS NULL OR comissao_base IN ('lucro_real','venda'));

-- ── fn_veic_custo_fixo_rateavel(company) → { valor, fonte } ─────────────────────────────────────────
-- Fonte 'manual' (custo_fixo_mensal_manual) é o que a tela usa hoje. A média 3 meses das contas_rateio
-- do plano depende do de-para gerencial↔contábil (ainda não ligado) → fica como próximo passo; sem manual
-- e sem essa ligação → 'nao_configurado' (nunca 0).
CREATE OR REPLACE FUNCTION public.fn_veic_custo_fixo_rateavel(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_manual numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT custo_fixo_mensal_manual INTO v_manual FROM veic_config WHERE company_id = p_company_id;
  IF v_manual IS NOT NULL AND v_manual > 0 THEN
    RETURN jsonb_build_object('ok', true, 'valor', v_manual, 'fonte', 'manual');
  END IF;
  RETURN jsonb_build_object('ok', true, 'valor', NULL, 'fonte', 'nao_configurado');
END $function$;

-- ── fn_veic_carrego_parametros(company) → parâmetros diários do carrego (RD-51: nunca 0) ────────────
CREATE OR REPLACE FUNCTION public.fn_veic_carrego_parametros(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v record; v_custo_fixo jsonb; v_cf numeric; v_ocupacao_dia numeric;
  v_capital_dia_pct numeric; v_deprec jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT * INTO v FROM veic_config WHERE company_id = p_company_id;

  v_custo_fixo := fn_veic_custo_fixo_rateavel(p_company_id);
  v_cf := NULLIF(v_custo_fixo->>'valor','')::numeric;

  -- ocupação: custo fixo mensal ÷ (vagas × 30 dias). Sem vagas ou sem custo → nao_configurado.
  v_ocupacao_dia := CASE WHEN COALESCE(v.vagas_operacionais,0) > 0 AND v_cf IS NOT NULL AND v_cf > 0
                         THEN round(v_cf / (v.vagas_operacionais * 30.0), 2) ELSE NULL END;

  -- capital: taxa a.a. ÷ 365 = %/dia sobre o capital parado no veículo. Sem taxa → nao_configurado.
  v_capital_dia_pct := CASE WHEN v.taxa_capital_aa IS NOT NULL AND v.taxa_capital_aa > 0
                            THEN round(v.taxa_capital_aa / 365.0, 6) ELSE NULL END;

  -- depreciação: fonte declarada. fipe fica travado (D7); curva_propria usa depreciacao_curva; nao_calcular = honesto.
  v_deprec := CASE v.depreciacao_fonte
    WHEN 'fipe'          THEN jsonb_build_object('fonte','fipe','status','travado','mensagem','Integração FIPE ainda não disponível (D7).')
    WHEN 'curva_propria' THEN jsonb_build_object('fonte','curva_propria','curva', v.depreciacao_curva,
                                'status', CASE WHEN v.depreciacao_curva IS NULL THEN 'nao_configurado' ELSE 'ok' END)
    ELSE jsonb_build_object('fonte', COALESCE(v.depreciacao_fonte,'nao_calcular'), 'status','nao_calcular')
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'ocupacao_dia', CASE WHEN v_ocupacao_dia IS NULL THEN NULL ELSE v_ocupacao_dia END,
    'ocupacao_status', CASE WHEN v_ocupacao_dia IS NULL THEN 'nao_configurado' ELSE 'ok' END,
    'custo_fixo_mensal', v_custo_fixo,
    'vagas', v.vagas_operacionais,
    'capital_dia_pct', v_capital_dia_pct,
    'capital_status', CASE WHEN v_capital_dia_pct IS NULL THEN 'nao_configurado' ELSE 'ok' END,
    'taxa_capital_aa', v.taxa_capital_aa,
    'depreciacao', v_deprec
  );
END $function$;

-- ── fn_veic_config_obter(company) → config completa + "o que falta" ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_config_obter(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v record; v_falta text[] := ARRAY[]::text[];
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT * INTO v FROM veic_config WHERE company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'existe', false,
      'falta', ARRAY['estrutura','custo_fixo','capital','margem','impostos','depreciacao','garantia','comissao','meta']::text[]);
  END IF;

  IF COALESCE(v.vagas_operacionais,0) <= 0 THEN v_falta := v_falta || 'estrutura'; END IF;
  IF v.custo_fixo_mensal_manual IS NULL AND (v.contas_rateio IS NULL OR array_length(v.contas_rateio,1) IS NULL) THEN v_falta := v_falta || 'custo_fixo'; END IF;
  IF v.taxa_capital_aa IS NULL THEN v_falta := v_falta || 'capital'; END IF;
  IF v.margem_alvo_pct IS NULL THEN v_falta := v_falta || 'margem'; END IF;
  IF v.impostos_venda_pct IS NULL OR v.comissao_venda_pct IS NULL OR v.provisao_garantia_pct IS NULL THEN v_falta := v_falta || 'impostos'; END IF;
  IF v.depreciacao_fonte IS NULL THEN v_falta := v_falta || 'depreciacao'; END IF;
  IF v.garantia_prazo_meses IS NULL THEN v_falta := v_falta || 'garantia'; END IF;
  IF v.comissao_base IS NULL THEN v_falta := v_falta || 'comissao'; END IF;
  IF v.meta_veiculos_mes IS NULL THEN v_falta := v_falta || 'meta'; END IF;

  RETURN jsonb_build_object('ok', true, 'existe', true, 'falta', v_falta, 'config', to_jsonb(v),
    'carrego', fn_veic_carrego_parametros(p_company_id));
END $function$;

-- ── fn_veic_config_previa_efeito(company, config_nova) → quantos veículos mudam de preço mínimo ─────
-- OBRIGATÓRIO antes de salvar em empresa real (lição da margem 20% na Alliance). Não persiste nada.
CREATE OR REPLACE FUNCTION public.fn_veic_config_previa_efeito(p_company_id uuid, p_config_nova jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_imp0 numeric; v_com0 numeric; v_gar0 numeric; v_margem0 numeric;
  v_imp1 numeric; v_com1 numeric; v_gar1 numeric; v_margem1 numeric;
  v_enc0 numeric; v_enc1 numeric; v_mudam int; v_total int; v_exemplos jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT impostos_venda_pct, comissao_venda_pct, provisao_garantia_pct, margem_alvo_pct
    INTO v_imp0, v_com0, v_gar0, v_margem0 FROM veic_config WHERE company_id = p_company_id;

  -- config nova: cada chave presente sobrepõe; ausente mantém a atual
  v_imp1    := COALESCE(NULLIF(p_config_nova->>'impostos_venda_pct','')::numeric, v_imp0);
  v_com1    := COALESCE(NULLIF(p_config_nova->>'comissao_venda_pct','')::numeric, v_com0);
  v_gar1    := COALESCE(NULLIF(p_config_nova->>'provisao_garantia_pct','')::numeric, v_gar0);
  v_margem1 := COALESCE(NULLIF(p_config_nova->>'margem_alvo_pct','')::numeric, v_margem0);
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

-- ── fn_veic_config_salvar estendida (novas colunas + validação + auditoria antes/depois) ───────────
CREATE OR REPLACE FUNCTION public.fn_veic_config_salvar(p_company_id uuid, p_dados jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_antes jsonb; v_depois jsonb;
  v_imp numeric; v_com numeric; v_gar numeric; v_margem numeric; v_sv int; v_sa int; v_vmodo text;
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
    impostos_venda_pct        = v_imp,
    comissao_venda_pct        = v_com,
    provisao_garantia_pct     = v_gar,
    vistoria_modo_padrao      = COALESCE(v_vmodo, veic_config.vistoria_modo_padrao),
    updated_at                = now();

  -- R2: colunas novas — chave presente é autoritativa (presente → grava; ausente → mantém). Validação de faixa.
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
    updated_at = now()
  WHERE company_id = p_company_id;

  SELECT to_jsonb(c) INTO v_depois FROM veic_config c WHERE company_id = p_company_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, COALESCE(p_user, auth.uid()), 'veic_config', p_company_id::text, 'config_salvar', v_antes, v_depois);

  RETURN jsonb_build_object('ok', true, 'config', v_depois, 'carrego', fn_veic_carrego_parametros(p_company_id));
END $function$;

REVOKE ALL ON FUNCTION public.fn_veic_custo_fixo_rateavel(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_carrego_parametros(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_config_obter(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_config_previa_efeito(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_custo_fixo_rateavel(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_carrego_parametros(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_config_obter(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_config_previa_efeito(uuid, jsonb) TO authenticated, service_role;
