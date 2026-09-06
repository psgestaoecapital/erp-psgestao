-- ============================================================
-- ONDA 6A · Precificacao · o preco de venda passa a EXISTIR (nao "melhorar" — criar)
-- Achado: veic_veiculo so tinha valor_aquisicao. Nunca houve preco de venda/minimo/margem.
-- O Compass foi vendido por 85k sem nunca ter tido preco no sistema. Corrigido aqui.
-- Convencao: todos os *_pct sao PERCENTUAIS (ex.: 12 = 12%), como veic_config.margem_alvo_pct.
-- ============================================================

-- 3.1 preco de venda no veiculo (NULL = nao precificado, nao zero)
ALTER TABLE public.veic_veiculo
  ADD COLUMN IF NOT EXISTS preco_venda      numeric,
  ADD COLUMN IF NOT EXISTS preco_minimo     numeric,
  ADD COLUMN IF NOT EXISTS margem_alvo_pct  numeric,
  ADD COLUMN IF NOT EXISTS precificado_em   timestamptz,
  ADD COLUMN IF NOT EXISTS precificado_por  uuid;
COMMENT ON COLUMN public.veic_veiculo.preco_venda IS
  'Preco de venda definido pela precificacao. NULL = veiculo nao precificado (nao e zero).';
COMMENT ON COLUMN public.veic_veiculo.preco_minimo IS
  'Piso calculado: abaixo disso o negocio da prejuizo com o que se sabe hoje.';

-- 3.2 historico — quem precificou, quanto e com que premissas (reprecificar nao apaga)
CREATE TABLE IF NOT EXISTS public.veic_precificacao_hist (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  veiculo_id     uuid NOT NULL REFERENCES public.veic_veiculo(id) ON DELETE CASCADE,
  preco_venda    numeric,
  preco_minimo   numeric,
  margem_alvo_pct numeric,
  custo_base     numeric,
  previsao_gastos numeric,
  impostos_pct   numeric,
  comissao_pct   numeric,
  premissas      jsonb,
  observacao     text,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  criado_por     uuid
);
CREATE INDEX IF NOT EXISTS ix_veic_precif_hist_veiculo ON public.veic_precificacao_hist (veiculo_id, criado_em DESC);
ALTER TABLE public.veic_precificacao_hist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS veic_precificacao_hist_rw ON public.veic_precificacao_hist;
CREATE POLICY veic_precificacao_hist_rw ON public.veic_precificacao_hist FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- 3.3 parametros na config da empresa (NULL = nao configurado, nunca zero)
ALTER TABLE public.veic_config
  ADD COLUMN IF NOT EXISTS impostos_venda_pct numeric,
  ADD COLUMN IF NOT EXISTS comissao_venda_pct numeric,
  ADD COLUMN IF NOT EXISTS provisao_garantia_pct numeric;

-- ------------------------------------------------------------
-- 4 · O motor
-- ------------------------------------------------------------

-- 4.1 tudo que a tela precisa, numa chamada
CREATE OR REPLACE FUNCTION public.fn_veic_precificacao_obter(p_veiculo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v record; v_comp uuid; v_custos numeric; v_custo_base numeric; v_custo_total numeric;
  v_vist_id uuid; v_previsao numeric; v_imp numeric; v_com numeric; v_gar numeric; v_margem numeric;
  v_enc_imp numeric; v_enc_com numeric; v_enc_gar numeric; v_soma_enc numeric;
  v_preco_min numeric; v_preco_sug numeric;
BEGIN
  v_comp := public.fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT id, company_id, marca, modelo, placa, valor_aquisicao, preco_venda, preco_minimo,
         margem_alvo_pct, precificado_em INTO v FROM veic_veiculo WHERE id = p_veiculo_id;

  SELECT COALESCE(sum(c.valor),0) INTO v_custos FROM veic_custo c WHERE c.veiculo_id = p_veiculo_id AND c.deleted_at IS NULL;
  v_custo_base := COALESCE(v.valor_aquisicao,0) + v_custos;

  -- previsao_gastos = ultima vistoria CONCLUIDA (NULL se nao houver — nao zero)
  SELECT id, previsao_total INTO v_vist_id, v_previsao FROM insp_vistoria
   WHERE alvo_tabela = 'veic_veiculo' AND alvo_id = p_veiculo_id AND situacao = 'concluida'
   ORDER BY concluida_em DESC LIMIT 1;

  v_custo_total := v_custo_base + COALESCE(v_previsao,0);

  SELECT impostos_venda_pct, comissao_venda_pct, provisao_garantia_pct, margem_alvo_pct
    INTO v_imp, v_com, v_gar, v_margem FROM veic_config WHERE company_id = v.company_id;
  v_margem := COALESCE(v.margem_alvo_pct, v_margem);  -- margem do veiculo tem precedencia sobre a da empresa

  v_enc_imp := v_custo_total * COALESCE(v_imp,0)/100;
  v_enc_com := v_custo_total * COALESCE(v_com,0)/100;
  v_enc_gar := v_custo_total * COALESCE(v_gar,0)/100;
  v_soma_enc := v_enc_imp + v_enc_com + v_enc_gar;
  v_preco_min := v_custo_total + v_soma_enc;
  v_preco_sug := CASE WHEN v_margem IS NOT NULL THEN v_custo_total * (1 + v_margem/100) + v_soma_enc ELSE NULL END;

  RETURN jsonb_build_object(
    'ok', true,
    'veiculo', jsonb_build_object('id', v.id, 'marca', v.marca, 'modelo', v.modelo, 'placa', v.placa),
    'custo', jsonb_build_object('aquisicao', v.valor_aquisicao, 'custos_lancados', v_custos,
      'previsao_gastos', v_previsao, 'custo_base', v_custo_base, 'custo_total', v_custo_total),
    'encargos', jsonb_build_object(
      'impostos', jsonb_build_object('pct', v_imp, 'valor', CASE WHEN v_imp IS NULL THEN NULL ELSE v_enc_imp END, 'configurado', v_imp IS NOT NULL),
      'comissao', jsonb_build_object('pct', v_com, 'valor', CASE WHEN v_com IS NULL THEN NULL ELSE v_enc_com END, 'configurado', v_com IS NOT NULL),
      'garantia', jsonb_build_object('pct', v_gar, 'valor', CASE WHEN v_gar IS NULL THEN NULL ELSE v_enc_gar END, 'configurado', v_gar IS NOT NULL)),
    'preco_minimo', v_preco_min,
    'preco_sugerido', v_preco_sug,
    'margem_alvo_pct', v_margem,
    'preco_venda', v.preco_venda,
    'precificado_em', v.precificado_em,
    'margem_projetada', CASE WHEN v.preco_venda IS NOT NULL THEN v.preco_venda - v_preco_min ELSE NULL END,
    'incerteza', jsonb_strip_nulls(jsonb_build_object(
      'sem_previsao_de_gastos', CASE WHEN v_vist_id IS NULL THEN true ELSE NULL END,
      'sem_custo_lancado', CASE WHEN v_custos = 0 THEN true ELSE NULL END,
      'impostos_nao_config', CASE WHEN v_imp IS NULL THEN true ELSE NULL END,
      'comissao_nao_config', CASE WHEN v_com IS NULL THEN true ELSE NULL END,
      'garantia_nao_config', CASE WHEN v_gar IS NULL THEN true ELSE NULL END)),
    'piso_incompleto', (v_imp IS NULL OR v_com IS NULL OR v_gar IS NULL),
    'historico', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'preco_venda', h.preco_venda, 'preco_minimo', h.preco_minimo, 'margem_alvo_pct', h.margem_alvo_pct,
        'custo_base', h.custo_base, 'previsao_gastos', h.previsao_gastos, 'premissas', h.premissas,
        'observacao', h.observacao, 'criado_em', h.criado_em) ORDER BY h.criado_em DESC), '[]'::jsonb)
      FROM veic_precificacao_hist h WHERE h.veiculo_id = p_veiculo_id));
END $function$;

-- 4.2 simulador reverso: parte do preco de venda, chega no teto de compra
CREATE OR REPLACE FUNCTION public.fn_veic_precificacao_simular(p_veiculo_id uuid, p_preco_venda numeric, p_margem_pct numeric)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v record; v_comp uuid; v_custos numeric; v_custo_base numeric; v_custo_total numeric;
  v_vist_id uuid; v_previsao numeric; v_imp numeric; v_com numeric; v_gar numeric;
  v_soma_pct numeric; v_teto numeric; v_preco_min numeric; v_soma_enc numeric;
BEGIN
  v_comp := public.fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT company_id, valor_aquisicao INTO v FROM veic_veiculo WHERE id = p_veiculo_id;
  SELECT COALESCE(sum(c.valor),0) INTO v_custos FROM veic_custo c WHERE c.veiculo_id = p_veiculo_id AND c.deleted_at IS NULL;
  v_custo_base := COALESCE(v.valor_aquisicao,0) + v_custos;
  SELECT id, previsao_total INTO v_vist_id, v_previsao FROM insp_vistoria
   WHERE alvo_tabela = 'veic_veiculo' AND alvo_id = p_veiculo_id AND situacao = 'concluida' ORDER BY concluida_em DESC LIMIT 1;
  v_custo_total := v_custo_base + COALESCE(v_previsao,0);
  SELECT impostos_venda_pct, comissao_venda_pct, provisao_garantia_pct INTO v_imp, v_com, v_gar FROM veic_config WHERE company_id = v.company_id;

  v_soma_pct := COALESCE(p_margem_pct,0) + COALESCE(v_imp,0) + COALESCE(v_com,0) + COALESCE(v_gar,0);
  v_soma_enc := v_custo_total * (COALESCE(v_imp,0) + COALESCE(v_com,0) + COALESCE(v_gar,0))/100;
  v_preco_min := v_custo_total + v_soma_enc;
  -- teto de compra: quanto pode pagar na aquisicao para vender a p_preco_venda com esses percentuais
  v_teto := (COALESCE(p_preco_venda,0) / (1 + v_soma_pct/100)) - COALESCE(v_previsao,0) - v_custos;

  RETURN jsonb_build_object('ok', true,
    'preco_venda', p_preco_venda, 'margem_pct', p_margem_pct,
    'custo_total', v_custo_total, 'previsao_gastos', v_previsao, 'custos_lancados', v_custos,
    'preco_minimo', v_preco_min,
    'margem_projetada', COALESCE(p_preco_venda,0) - v_preco_min,
    'teto_de_compra', v_teto,
    'abaixo_do_piso', (p_preco_venda IS NOT NULL AND p_preco_venda < v_preco_min),
    'prejuizo_no_piso', CASE WHEN p_preco_venda IS NOT NULL AND p_preco_venda < v_preco_min THEN v_preco_min - p_preco_venda ELSE 0 END,
    'sem_previsao_de_gastos', v_vist_id IS NULL);
END $function$;

-- 4.3 grava o preco + historico (o servidor recalcula as premissas — o front nao mente os numeros)
CREATE OR REPLACE FUNCTION public.fn_veic_precificacao_salvar(p_veiculo_id uuid, p_dados jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v record; v_comp uuid; v_custos numeric; v_custo_base numeric; v_custo_total numeric;
  v_previsao numeric; v_imp numeric; v_com numeric; v_gar numeric;
  v_preco_venda numeric; v_margem numeric; v_preco_min numeric; v_soma_enc numeric; v_hist uuid;
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
         precificado_em = now(), precificado_por = p_user, updated_at = now(), updated_by = p_user
   WHERE id = p_veiculo_id;

  INSERT INTO veic_precificacao_hist (company_id, veiculo_id, preco_venda, preco_minimo, margem_alvo_pct,
      custo_base, previsao_gastos, impostos_pct, comissao_pct, premissas, observacao, criado_por)
  VALUES (v.company_id, p_veiculo_id, v_preco_venda, v_preco_min, v_margem, v_custo_base, v_previsao, v_imp, v_com,
      jsonb_build_object('impostos_pct', v_imp, 'comissao_pct', v_com, 'garantia_pct', v_gar,
        'custo_total', v_custo_total, 'tinha_vistoria', v_previsao IS NOT NULL),
      NULLIF(btrim(p_dados->>'observacao'),''), p_user)
  RETURNING id INTO v_hist;

  RETURN jsonb_build_object('ok', true, 'preco_venda', v_preco_venda, 'preco_minimo', v_preco_min, 'hist_id', v_hist);
END $function$;

-- 4.4 o que a loja sabe sobre este modelo (custo zero, dado proprio). <2 vendas -> nao afirma media.
CREATE OR REPLACE FUNCTION public.fn_veic_modelo_estatisticas(p_company_id uuid, p_marca text, p_modelo text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_n int; v_dias numeric; v_margem numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  WITH vendas AS (
    SELECT ve.data_venda, ve.valor_venda, vv.data_entrada, vv.valor_aquisicao,
           (COALESCE(vv.valor_aquisicao,0) + COALESCE((SELECT sum(c.valor) FROM veic_custo c WHERE c.veiculo_id = vv.id AND c.deleted_at IS NULL),0)) AS custo
      FROM veic_venda ve JOIN veic_veiculo vv ON vv.id = ve.veiculo_id
     WHERE ve.company_id = p_company_id AND ve.deleted_at IS NULL AND ve.situacao <> 'cancelada'
       AND vv.marca IS NOT DISTINCT FROM p_marca AND vv.modelo IS NOT DISTINCT FROM p_modelo)
  SELECT count(*),
         avg((data_venda - data_entrada)::numeric),
         avg(CASE WHEN custo > 0 THEN (valor_venda - custo)/custo*100 END)
    INTO v_n, v_dias, v_margem FROM vendas;

  IF COALESCE(v_n,0) < 2 THEN
    RETURN jsonb_build_object('ok', true, 'tem_historico', false, 'n_vendas', COALESCE(v_n,0),
      'motivo', 'historico_insuficiente'); END IF;

  RETURN jsonb_build_object('ok', true, 'tem_historico', true, 'n_vendas', v_n,
    'dias_medio_patio', round(v_dias,0), 'margem_media_pct', round(v_margem,1));
END $function$;
