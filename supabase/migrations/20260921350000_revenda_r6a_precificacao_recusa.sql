-- Revenda R6a · Precificação completa (Tela 8) — motor. RDs 51·55·65·70. Guarda de empresa; sem anon.
--
-- CORREÇÃO do CEO (RD-65, evita o erro da R0 = dois números para o mesmo carro): recusar item da
-- avaliação NÃO vale só no simulador. A recusa entra na FONTE ÚNICA: fn_veic_previsao_vistoria_ajustada
-- = previsão da vistoria − itens recusados (lendo a cadeia insp_ só para leitura, sem alterá-la), e
-- fn_veic_preco_minimo / fn_veic_precificacao_obter passam a usar essa função no lugar da previsão bruta.
-- Como fn_veic_conta_do_carro lê o preço mínimo, ela segue junto. O simulador lê o MESMO número.
-- Reativar o item volta tudo. Aditivo/idempotente.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- (1) veic_avaliacao_recusa — o dono recusa um item da vistoria (não vou consertar), com motivo.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS veic_avaliacao_recusa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  veiculo_id uuid NOT NULL REFERENCES veic_veiculo(id) ON DELETE CASCADE,
  insp_resposta_id uuid NOT NULL REFERENCES insp_resposta(id) ON DELETE CASCADE,
  motivo text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  recusado_por uuid, recusado_em timestamptz NOT NULL DEFAULT now(),
  reativado_por uuid, reativado_em timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_veic_avaliacao_recusa ON veic_avaliacao_recusa(insp_resposta_id);
CREATE INDEX IF NOT EXISTS ix_veic_avaliacao_recusa_veic ON veic_avaliacao_recusa(veiculo_id, ativo);
ALTER TABLE veic_avaliacao_recusa ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.veic_avaliacao_recusa'::regclass AND polname='veic_avaliacao_recusa_rw') THEN
    CREATE POLICY veic_avaliacao_recusa_rw ON veic_avaliacao_recusa FOR ALL
      USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
      WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.veic_avaliacao_recusa TO authenticated;
GRANT ALL ON public.veic_avaliacao_recusa TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- (2) fn_veic_previsao_vistoria_ajustada — previsão bruta da vistoria concluída − itens recusados.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_previsao_vistoria_ajustada(p_veiculo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_vist uuid; v_bruta numeric; v_recusada numeric;
BEGIN
  SELECT id, previsao_total INTO v_vist, v_bruta FROM insp_vistoria
    WHERE alvo_tabela='veic_veiculo' AND alvo_id=p_veiculo_id AND situacao='concluida'
    ORDER BY concluida_em DESC LIMIT 1;
  IF v_vist IS NULL THEN
    RETURN jsonb_build_object('vistoria_id', NULL, 'bruta', NULL, 'recusada', 0, 'ajustada', NULL); END IF;
  SELECT COALESCE(sum(ir.gasto_previsto),0) INTO v_recusada
    FROM veic_avaliacao_recusa r JOIN insp_resposta ir ON ir.id = r.insp_resposta_id
    WHERE r.veiculo_id = p_veiculo_id AND r.ativo = true AND ir.vistoria_id = v_vist;
  RETURN jsonb_build_object('vistoria_id', v_vist, 'bruta', v_bruta, 'recusada', v_recusada,
    'ajustada', GREATEST(COALESCE(v_bruta,0) - COALESCE(v_recusada,0), 0));
END $function$;
REVOKE ALL ON FUNCTION public.fn_veic_previsao_vistoria_ajustada(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_previsao_vistoria_ajustada(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- (3) fn_veic_preco_minimo — FONTE ÚNICA, agora com previsão AJUSTADA (recusa entra aqui).
--     Corpo idêntico ao R0.1, trocando só a leitura da previsão pela função ajustada.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_preco_minimo(p_veiculo_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v record; v_comp uuid; v_custos numeric; v_previsao numeric; v_vist_id uuid; v_aj jsonb;
  v_custo_total numeric; v_imp numeric; v_com numeric; v_gar numeric; v_margem numeric;
  v_soma_enc_frac numeric; v_margem_frac numeric; v_denom_min numeric; v_denom_piso numeric;
  v_preco_min numeric; v_piso numeric;
BEGIN
  v_comp := public.fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT id, company_id, marca, modelo, placa, valor_aquisicao, margem_alvo_pct
    INTO v FROM veic_veiculo WHERE id = p_veiculo_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_inexistente'); END IF;

  SELECT COALESCE(sum(c.valor),0) INTO v_custos FROM veic_custo c
    WHERE c.veiculo_id = p_veiculo_id AND c.deleted_at IS NULL;
  v_aj := fn_veic_previsao_vistoria_ajustada(p_veiculo_id);   -- previsão − itens recusados (RD-65)
  v_vist_id := NULLIF(v_aj->>'vistoria_id','')::uuid;
  v_previsao := NULLIF(v_aj->>'ajustada','')::numeric;
  v_custo_total := COALESCE(v.valor_aquisicao,0) + v_custos + COALESCE(v_previsao,0);

  SELECT impostos_venda_pct, comissao_venda_pct, provisao_garantia_pct, margem_alvo_pct
    INTO v_imp, v_com, v_gar, v_margem FROM veic_config WHERE company_id = v.company_id;
  v_margem := COALESCE(v.margem_alvo_pct, v_margem);

  v_soma_enc_frac := (COALESCE(v_imp,0) + COALESCE(v_com,0) + COALESCE(v_gar,0)) / 100.0;
  v_margem_frac   := COALESCE(v_margem,0) / 100.0;
  v_denom_min  := 1 - v_soma_enc_frac - v_margem_frac;
  v_denom_piso := 1 - v_soma_enc_frac;

  v_preco_min := CASE WHEN COALESCE(v.valor_aquisicao,0) > 0 AND v_denom_min  > 0.0001
                      THEN round(v_custo_total / v_denom_min, 2)  ELSE NULL END;
  v_piso      := CASE WHEN COALESCE(v.valor_aquisicao,0) > 0 AND v_denom_piso > 0.0001
                      THEN round(v_custo_total / v_denom_piso, 2) ELSE NULL END;

  RETURN jsonb_build_object(
    'ok', true,
    'veiculo', jsonb_build_object('id', v.id, 'marca', v.marca, 'modelo', v.modelo, 'placa', v.placa),
    'custo', jsonb_build_object('aquisicao', v.valor_aquisicao, 'custos_lancados', v_custos,
      'previsao_gastos', v_previsao, 'previsao_bruta', NULLIF(v_aj->>'bruta','')::numeric,
      'previsao_recusada', NULLIF(v_aj->>'recusada','')::numeric, 'custo_total', v_custo_total),
    'encargos_pct', jsonb_build_object('impostos', v_imp, 'comissao', v_com, 'garantia', v_gar,
      'soma', COALESCE(v_imp,0)+COALESCE(v_com,0)+COALESCE(v_gar,0)),
    'margem_pct', v_margem,
    'preco_minimo', v_preco_min,
    'piso_sem_margem', v_piso,
    'detalhe', CASE WHEN v_preco_min IS NULL THEN NULL ELSE jsonb_build_object(
      'impostos_valor', round(v_preco_min * COALESCE(v_imp,0)/100, 2),
      'comissao_valor', round(v_preco_min * COALESCE(v_com,0)/100, 2),
      'garantia_valor', round(v_preco_min * COALESCE(v_gar,0)/100, 2),
      'margem_valor',   round(v_preco_min * COALESCE(v_margem,0)/100, 2)) END,
    'flags', jsonb_build_object(
      'sem_custo_aquisicao', COALESCE(v.valor_aquisicao,0) <= 0,
      'sem_vistoria', v_vist_id IS NULL,
      'piso_incompleto', (v_imp IS NULL OR v_com IS NULL OR v_gar IS NULL),
      'sem_margem_config', v_margem IS NULL,
      'encargos_margem_inviaveis', (v_denom_min <= 0.0001)));
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- (4) fn_veic_precificacao_obter — mesma tela, previsão AJUSTADA (custo + incerteza) via fonte única.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_precificacao_obter(p_veiculo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v record; v_comp uuid; v_custos numeric; v_custo_base numeric; v_custo_total numeric;
  v_vist_id uuid; v_previsao numeric; v_imp numeric; v_com numeric; v_gar numeric; v_margem numeric;
  v_pm jsonb; v_preco_min numeric; v_piso numeric; v_aj jsonb;
BEGIN
  v_comp := public.fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT id, company_id, marca, modelo, placa, valor_aquisicao, preco_venda, preco_minimo,
         margem_alvo_pct, precificado_em INTO v FROM veic_veiculo WHERE id = p_veiculo_id;

  SELECT COALESCE(sum(c.valor),0) INTO v_custos FROM veic_custo c WHERE c.veiculo_id = p_veiculo_id AND c.deleted_at IS NULL;
  v_custo_base := COALESCE(v.valor_aquisicao,0) + v_custos;
  v_aj := fn_veic_previsao_vistoria_ajustada(p_veiculo_id);
  v_vist_id := NULLIF(v_aj->>'vistoria_id','')::uuid;
  v_previsao := NULLIF(v_aj->>'ajustada','')::numeric;
  v_custo_total := v_custo_base + COALESCE(v_previsao,0);

  SELECT impostos_venda_pct, comissao_venda_pct, provisao_garantia_pct, margem_alvo_pct
    INTO v_imp, v_com, v_gar, v_margem FROM veic_config WHERE company_id = v.company_id;
  v_margem := COALESCE(v.margem_alvo_pct, v_margem);

  v_pm := public.fn_veic_preco_minimo(p_veiculo_id);
  v_preco_min := NULLIF(v_pm->>'preco_minimo','')::numeric;
  v_piso      := NULLIF(v_pm->>'piso_sem_margem','')::numeric;

  RETURN jsonb_build_object(
    'ok', true,
    'veiculo', jsonb_build_object('id', v.id, 'marca', v.marca, 'modelo', v.modelo, 'placa', v.placa),
    'custo', jsonb_build_object('aquisicao', v.valor_aquisicao, 'custos_lancados', v_custos,
      'previsao_gastos', v_previsao, 'custo_base', v_custo_base, 'custo_total', v_custo_total),
    'encargos', jsonb_build_object(
      'impostos', jsonb_build_object('pct', v_imp, 'valor', CASE WHEN v_imp IS NULL THEN NULL ELSE (v_pm->'detalhe'->>'impostos_valor')::numeric END, 'configurado', v_imp IS NOT NULL),
      'comissao', jsonb_build_object('pct', v_com, 'valor', CASE WHEN v_com IS NULL THEN NULL ELSE (v_pm->'detalhe'->>'comissao_valor')::numeric END, 'configurado', v_com IS NOT NULL),
      'garantia', jsonb_build_object('pct', v_gar, 'valor', CASE WHEN v_gar IS NULL THEN NULL ELSE (v_pm->'detalhe'->>'garantia_valor')::numeric END, 'configurado', v_gar IS NOT NULL)),
    'preco_minimo', v_preco_min,
    'piso_sem_margem', v_piso,
    'preco_sugerido', v_preco_min,
    'margem_alvo_pct', v_margem,
    'preco_venda', v.preco_venda,
    'precificado_em', v.precificado_em,
    'margem_projetada', CASE WHEN v.preco_venda IS NOT NULL AND v_preco_min IS NOT NULL THEN v.preco_venda - v_preco_min ELSE NULL END,
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

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- (5) itens da avaliação + recusar / reativar (o recusar exige motivo).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_avaliacao_itens(p_veiculo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_vist uuid; v_itens jsonb; v_aj jsonb;
BEGIN
  v_comp := fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT id INTO v_vist FROM insp_vistoria
    WHERE alvo_tabela='veic_veiculo' AND alvo_id=p_veiculo_id AND situacao='concluida'
    ORDER BY concluida_em DESC LIMIT 1;
  v_aj := fn_veic_previsao_vistoria_ajustada(p_veiculo_id);
  IF v_vist IS NULL THEN RETURN jsonb_build_object('ok', true, 'vistoria_id', NULL, 'itens', '[]'::jsonb, 'previsao', v_aj); END IF;
  SELECT jsonb_agg(jsonb_build_object(
      'resposta_id', ir.id, 'item', ii.nome, 'estado', ir.estado, 'descricao', ir.descricao,
      'gasto_previsto', ir.gasto_previsto,
      'recusado', (r.id IS NOT NULL AND r.ativo), 'motivo', CASE WHEN r.ativo THEN r.motivo ELSE NULL END)
      ORDER BY ir.gasto_previsto DESC NULLS LAST)
    INTO v_itens
    FROM insp_resposta ir JOIN insp_item ii ON ii.id = ir.item_id
    LEFT JOIN veic_avaliacao_recusa r ON r.insp_resposta_id = ir.id
    WHERE ir.vistoria_id = v_vist AND COALESCE(ir.gasto_previsto,0) > 0;
  RETURN jsonb_build_object('ok', true, 'vistoria_id', v_vist, 'previsao', v_aj, 'itens', COALESCE(v_itens,'[]'::jsonb));
END $function$;

CREATE OR REPLACE FUNCTION public.fn_veic_avaliacao_recusar(p_veiculo_id uuid, p_resposta_id uuid, p_motivo text, p_user uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid;
BEGIN
  v_comp := fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF COALESCE(btrim(p_motivo),'') = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio'); END IF;
  IF NOT EXISTS (SELECT 1 FROM insp_resposta ir JOIN insp_vistoria iv ON iv.id=ir.vistoria_id
                  WHERE ir.id=p_resposta_id AND iv.alvo_tabela='veic_veiculo' AND iv.alvo_id=p_veiculo_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'item_nao_pertence_ao_veiculo'); END IF;
  INSERT INTO veic_avaliacao_recusa (company_id, veiculo_id, insp_resposta_id, motivo, ativo, recusado_por)
  VALUES (v_comp, p_veiculo_id, p_resposta_id, btrim(p_motivo), true, COALESCE(p_user, auth.uid()))
  ON CONFLICT (insp_resposta_id) DO UPDATE SET ativo=true, motivo=btrim(p_motivo),
    recusado_por=COALESCE(p_user, auth.uid()), recusado_em=now(), reativado_por=NULL, reativado_em=NULL;
  RETURN jsonb_build_object('ok', true, 'previsao', fn_veic_previsao_vistoria_ajustada(p_veiculo_id),
    'preco_minimo', (fn_veic_preco_minimo(p_veiculo_id))->>'preco_minimo');
END $function$;

CREATE OR REPLACE FUNCTION public.fn_veic_avaliacao_reativar(p_veiculo_id uuid, p_resposta_id uuid, p_user uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid;
BEGIN
  v_comp := fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE veic_avaliacao_recusa SET ativo=false, reativado_por=COALESCE(p_user, auth.uid()), reativado_em=now()
   WHERE insp_resposta_id = p_resposta_id AND veiculo_id = p_veiculo_id;
  RETURN jsonb_build_object('ok', true, 'previsao', fn_veic_previsao_vistoria_ajustada(p_veiculo_id),
    'preco_minimo', (fn_veic_preco_minimo(p_veiculo_id))->>'preco_minimo');
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- (6) fn_veic_precificacao_cenarios — cenários hoje/30/60/120, giro do modelo, comparação de estoque,
--     selo de frescor, histórico. TUDO da fonte única (conta_do_carro + carrego). Nada calculado na tela.
--     Nome distinto do fn_veic_precificacao_simular(uuid,numeric,numeric) já existente (what-if de preço).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_precificacao_cenarios(p_veiculo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v record; conta jsonb; v_pm jsonb; v_anunciado numeric; v_preco_min numeric; v_ref numeric; v_ref_fonte text;
  v_custo numeric; v_sangria numeric;
  v_enc numeric; v_enc_frac numeric; v_cenarios jsonb := '[]'::jsonb; d int;
  v_giro_media numeric; v_giro_n int; v_dias int; v_comp_estoque jsonb; v_frescor jsonb; v_precif_em timestamptz;
BEGIN
  v_comp := fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT id, company_id, marca, modelo, precificado_em INTO v FROM veic_veiculo WHERE id = p_veiculo_id;

  conta := fn_veic_conta_do_carro(p_veiculo_id);
  IF (conta->>'ok')::boolean IS NOT TRUE THEN RETURN conta; END IF;
  v_pm        := fn_veic_preco_minimo(p_veiculo_id);
  v_preco_min := NULLIF(v_pm->>'preco_minimo','')::numeric;
  v_anunciado := NULLIF(conta->>'anunciado','')::numeric;
  -- preço de referência dos cenários: o anunciado quando já precificado; senão o preço mínimo sugerido
  -- (assim um carro ainda SEM preço já mostra o lucro projetado no preço que cobre custo+encargos+margem).
  v_ref       := COALESCE(v_anunciado, v_preco_min);
  v_ref_fonte := CASE WHEN v_anunciado IS NOT NULL THEN 'anunciado' WHEN v_preco_min IS NOT NULL THEN 'sugerido' ELSE NULL END;
  v_custo     := NULLIF(conta->>'custo_real_total','')::numeric;   -- já inclui carrego até hoje + previsão ajustada
  v_sangria   := NULLIF(conta->>'sangria_dia','')::numeric;
  v_enc       := NULLIF(conta->>'encargos_pct','')::numeric;
  v_dias      := NULLIF(conta->>'dias_parado','')::int;
  v_enc_frac  := COALESCE(v_enc,0)/100.0;

  -- CENÁRIOS: hoje/30/60/120 — o carrego cresce sangria_dia × N dias FUTUROS → custo sobe, lucro cai.
  FOREACH d IN ARRAY ARRAY[0,30,60,120] LOOP
    v_cenarios := v_cenarios || jsonb_build_array(jsonb_build_object(
      'dias', d,
      'custo_projetado', CASE WHEN v_custo IS NULL OR v_sangria IS NULL THEN NULL ELSE round(v_custo + v_sangria*d, 2) END,
      'lucro_real', CASE WHEN v_ref IS NULL OR v_custo IS NULL OR v_sangria IS NULL THEN NULL
                         ELSE round(v_ref*(1-v_enc_frac) - (v_custo + v_sangria*d), 2) END));
  END LOOP;

  -- GIRO DO MODELO: média de dias-a-vender do mesmo modelo (vendas com data), + recomendação.
  SELECT round(avg(vd.data_venda - vv.data_entrada)::numeric, 0), count(*)
    INTO v_giro_media, v_giro_n
    FROM veic_venda vd JOIN veic_veiculo vv ON vv.id = vd.veiculo_id
    WHERE vv.company_id = v.company_id AND vv.modelo = v.modelo
      AND vd.deleted_at IS NULL AND vd.data_venda IS NOT NULL AND vv.data_entrada IS NOT NULL;

  -- COMPARAÇÃO com o estoque do mesmo modelo (outros no pátio).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'veiculo_id', o.id, 'placa', o.placa, 'preco_venda', o.preco_venda,
      'dias_parado', CASE WHEN o.data_entrada IS NULL THEN NULL ELSE (current_date - o.data_entrada) END) ORDER BY o.data_entrada), '[]'::jsonb)
    INTO v_comp_estoque
    FROM veic_veiculo o
    WHERE o.company_id = v.company_id AND o.modelo = v.modelo AND o.id <> p_veiculo_id
      AND o.deleted_at IS NULL AND o.situacao NOT IN ('vendido','entregue');

  -- SELO DE FRESCOR da fonte de valor (manual há N dias; FIPE 🔒 D7 — não integrada ainda).
  v_precif_em := v.precificado_em;
  v_frescor := jsonb_build_object(
    'fonte', 'manual',
    'precificado_em', v_precif_em,
    'dias_desde', CASE WHEN v_precif_em IS NULL THEN NULL ELSE (current_date - v_precif_em::date) END,
    'fipe', jsonb_build_object('status', 'travado_d7', 'nota', 'FIPE ainda não integrada (D7).'));

  RETURN jsonb_build_object('ok', true,
    'veiculo', jsonb_build_object('id', v.id, 'marca', v.marca, 'modelo', v.modelo),
    'anunciado', v_anunciado, 'preco_minimo_sugerido', v_preco_min,
    'preco_referencia', v_ref, 'preco_referencia_fonte', v_ref_fonte,
    'custo_real_hoje', v_custo, 'sangria_dia', v_sangria, 'encargos_pct', v_enc,
    'dias_parado', v_dias,
    'cenarios', v_cenarios,
    'giro_modelo', jsonb_build_object(
      'dias_medios', v_giro_media, 'amostra', COALESCE(v_giro_n,0),
      'este_dias', v_dias,
      'recomendacao', CASE
        WHEN v_giro_media IS NULL THEN 'sem_historico'
        WHEN v_dias IS NOT NULL AND v_dias > v_giro_media THEN 'acima_do_giro'
        ELSE 'dentro_do_giro' END),
    'comparacao_estoque', v_comp_estoque,
    'frescor', v_frescor,
    'preco_minimo', (fn_veic_preco_minimo(p_veiculo_id)),
    'historico', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'preco_venda', h.preco_venda, 'preco_minimo', h.preco_minimo, 'criado_em', h.criado_em,
        'observacao', h.observacao) ORDER BY h.criado_em DESC), '[]'::jsonb)
      FROM veic_precificacao_hist h WHERE h.veiculo_id = p_veiculo_id));
END $function$;

REVOKE ALL ON FUNCTION public.fn_veic_avaliacao_itens(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_precificacao_cenarios(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_avaliacao_itens(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_avaliacao_recusar(uuid, uuid, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_avaliacao_reativar(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_precificacao_cenarios(uuid) TO authenticated, service_role;
