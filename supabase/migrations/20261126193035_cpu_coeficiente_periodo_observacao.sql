-- PR 2 do CPU (CEO 24/11) — Catálogo de Serviços: período de utilização + método de cálculo do
-- coeficiente (consumo por unidade) + observação do cálculo. Vale para QUALQUER ramo do Hub.
-- Aditiva (RD-97). A coluna observacao de projetos_servicos_bom JÁ existe (RD-38 conferido no schema);
-- aqui só entram os campos de período/método e os dias úteis/mês por empresa.
-- RD-52: arquivo + PR; nunca apply_migration.

-- 1) Campos de período/método no item do BOM (coeficiente = quantidade)
ALTER TABLE public.projetos_servicos_bom
  ADD COLUMN IF NOT EXISTS periodo_valor numeric(12,2),
  ADD COLUMN IF NOT EXISTS periodo_unidade text,
  ADD COLUMN IF NOT EXISTS qtd_por_periodo numeric(12,4),
  ADD COLUMN IF NOT EXISTS metodo_coeficiente text;

-- período em dias/horas/meses (opcional); método: uma das 5 formas (manual = digitar direto)
ALTER TABLE public.projetos_servicos_bom DROP CONSTRAINT IF EXISTS bom_periodo_unidade_check;
ALTER TABLE public.projetos_servicos_bom ADD CONSTRAINT bom_periodo_unidade_check
  CHECK (periodo_unidade IS NULL OR periodo_unidade IN ('dias','horas','meses'));
ALTER TABLE public.projetos_servicos_bom DROP CONSTRAINT IF EXISTS bom_metodo_coeficiente_check;
ALTER TABLE public.projetos_servicos_bom ADD CONSTRAINT bom_metodo_coeficiente_check
  CHECK (metodo_coeficiente IS NULL OR metodo_coeficiente IN ('manual','rendimento','tecnico','vida_util','por_pessoa'));

-- 2) Dias úteis/mês por empresa (base do cálculo por período) — padrão 22, editável na config
ALTER TABLE public.projetos_modulo_config
  ADD COLUMN IF NOT EXISTS dias_uteis_mes integer NOT NULL DEFAULT 22;
ALTER TABLE public.projetos_modulo_config DROP CONSTRAINT IF EXISTS projetos_config_dias_uteis_check;
ALTER TABLE public.projetos_modulo_config ADD CONSTRAINT projetos_config_dias_uteis_check
  CHECK (dias_uteis_mes BETWEEN 1 AND 31);

-- 3) RPC de leitura do serviço: expor os novos campos do item do BOM (observacao já saía; faltavam período/método).
--    CREATE OR REPLACE (cópia fiel da versão viva 20261120160030) + 4 campos no jsonb do BOM. Guarda de empresa mantida.
CREATE OR REPLACE FUNCTION public.fn_projetos_servico_completo(p_servico_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_servico jsonb;
  v_bom jsonb;
  v_config jsonb;
  v_validacao jsonb;
BEGIN
  SELECT to_jsonb(s.*) INTO v_servico FROM projetos_servicos s WHERE s.id = p_servico_id;
  IF v_servico IS NULL THEN RETURN jsonb_build_object('error', 'servico nao encontrado'); END IF;

  IF (v_servico->>'company_id')::uuid NOT IN (SELECT get_user_company_ids())
     AND NOT COALESCE((v_servico->>'is_publico')::boolean, false)
     AND NOT is_admin() THEN
    RETURN jsonb_build_object('error', 'sem acesso');
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', bom.id,
      'tipo', bom.tipo,
      'item_id', COALESCE(bom.produto_id, bom.insumo_id, bom.mao_obra_id),
      'produto_id', bom.produto_id,
      'local_id', bom.local_id,
      'item_nome', COALESCE(bom.item_nome_manual, p.nome, i.name, mo.funcao),
      'item_categoria', CASE
        WHEN bom.tipo = 'mao_obra' THEN 'mao_obra'
        WHEN bom.tipo = 'epi' THEN 'epi'
        WHEN bom.produto_id IS NOT NULL THEN COALESCE(p.categoria, bom.tipo)
        ELSE COALESCE(i.category, bom.tipo)
      END,
      'quantidade', bom.quantidade,
      'unidade', bom.unidade,
      'perda_pct', bom.perda_pct,
      'custo_unitario', bom.custo_unitario,
      'custo_total', bom.custo_total,
      'ordem', bom.ordem,
      'observacao', bom.observacao,
      'periodo_valor', bom.periodo_valor,
      'periodo_unidade', bom.periodo_unidade,
      'qtd_por_periodo', bom.qtd_por_periodo,
      'metodo_coeficiente', bom.metodo_coeficiente
    ) ORDER BY bom.ordem, bom.id
  ) INTO v_bom
  FROM projetos_servicos_bom bom
  LEFT JOIN m16_insumos i       ON i.id = bom.insumo_id
  LEFT JOIN projetos_mao_obra mo ON mo.id = bom.mao_obra_id
  LEFT JOIN erp_produtos p       ON p.id = bom.produto_id
  WHERE bom.servico_id = p_servico_id;

  SELECT to_jsonb(c.*) INTO v_config FROM projetos_modulo_config c WHERE c.company_id = (v_servico->>'company_id')::uuid;

  v_validacao := jsonb_build_object(
    'tem_material', EXISTS (SELECT 1 FROM projetos_servicos_bom WHERE servico_id = p_servico_id AND tipo IN ('insumo', 'equipamento')),
    'tem_mao_obra', EXISTS (SELECT 1 FROM projetos_servicos_bom WHERE servico_id = p_servico_id AND tipo = 'mao_obra'),
    'tem_epi', EXISTS (SELECT 1 FROM projetos_servicos_bom WHERE servico_id = p_servico_id AND tipo = 'epi'),
    'tem_produtividade', (v_servico->>'produtividade_unidade_dia') IS NOT NULL,
    'tem_custo_calculado', (v_servico->>'custo_unitario_total')::numeric > 0,
    'qtd_itens_bom', COALESCE(jsonb_array_length(v_bom), 0)
  );

  RETURN jsonb_build_object(
    'servico', v_servico,
    'bom', COALESCE(v_bom, '[]'::jsonb),
    'config', v_config,
    'validacao', v_validacao,
    'preview', jsonb_build_object(
      'custo_total', (v_servico->>'custo_unitario_total')::numeric,
      'bdi_pct', COALESCE((v_config->>'bdi_total_pct')::numeric, 0),
      'preco_venda', round((v_servico->>'custo_unitario_total')::numeric * (1 + COALESCE((v_config->>'bdi_total_pct')::numeric, 0)/100), 2),
      'lucro_estimado', round((v_servico->>'custo_unitario_total')::numeric * COALESCE((v_config->>'bdi_lucro_pct')::numeric, 0)/100, 2)
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_servico_completo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_servico_completo(uuid) TO authenticated, service_role;

-- 3b) RPC de salvar config: persistir dias_uteis_mes (whitelist explícita). Cópia fiel da versão viva
--     20261106131035 + dias_uteis_mes no UPDATE e na validação. Guarda de empresa mantida.
CREATE OR REPLACE FUNCTION public.fn_projetos_config_salvar(p_company_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_row projetos_modulo_config%ROWTYPE;
  v_old projetos_modulo_config%ROWTYPE;
  v_num text[] := ARRAY['bdi_admin_central_pct','bdi_seguros_pct','bdi_riscos_pct','bdi_garantias_pct',
                        'bdi_despesas_financeiras_pct','bdi_lucro_pct','bdi_impostos_pct',
                        'margem_alvo_pct','margem_minima_pct'];
  v_k text;
  v_v numeric;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND (p_company_id IS NULL OR p_company_id NOT IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF p_company_id IS NULL OR p_dados IS NULL OR jsonb_typeof(p_dados) <> 'object' THEN
    RAISE EXCEPTION 'Dados inválidos' USING ERRCODE = '22023';
  END IF;

  FOREACH v_k IN ARRAY v_num LOOP
    IF p_dados ? v_k AND p_dados->>v_k IS NOT NULL THEN
      v_v := (p_dados->>v_k)::numeric;
      IF v_v < 0 OR v_v > 100 OR (v_k = 'bdi_impostos_pct' AND v_v >= 100) THEN
        RAISE EXCEPTION 'Percentual fora da faixa: % = %', v_k, v_v USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;
  IF (p_dados ? 'validade_proposta_dias' AND (p_dados->>'validade_proposta_dias')::int < 0)
     OR (p_dados ? 'prazo_pagamento_padrao_dias' AND (p_dados->>'prazo_pagamento_padrao_dias')::int < 0) THEN
    RAISE EXCEPTION 'Prazo em dias não pode ser negativo' USING ERRCODE = '22023';
  END IF;
  IF p_dados ? 'dias_uteis_mes' AND p_dados->>'dias_uteis_mes' IS NOT NULL
     AND ((p_dados->>'dias_uteis_mes')::int < 1 OR (p_dados->>'dias_uteis_mes')::int > 31) THEN
    RAISE EXCEPTION 'Dias úteis por mês deve ficar entre 1 e 31' USING ERRCODE = '22023';
  END IF;

  INSERT INTO projetos_modulo_config (company_id) VALUES (p_company_id) ON CONFLICT (company_id) DO NOTHING;

  SELECT * INTO v_old FROM projetos_modulo_config WHERE company_id = p_company_id;

  UPDATE projetos_modulo_config c SET
    bdi_admin_central_pct        = COALESCE((p_dados->>'bdi_admin_central_pct')::numeric, c.bdi_admin_central_pct),
    bdi_seguros_pct              = COALESCE((p_dados->>'bdi_seguros_pct')::numeric, c.bdi_seguros_pct),
    bdi_riscos_pct               = COALESCE((p_dados->>'bdi_riscos_pct')::numeric, c.bdi_riscos_pct),
    bdi_garantias_pct            = COALESCE((p_dados->>'bdi_garantias_pct')::numeric, c.bdi_garantias_pct),
    bdi_despesas_financeiras_pct = COALESCE((p_dados->>'bdi_despesas_financeiras_pct')::numeric, c.bdi_despesas_financeiras_pct),
    bdi_lucro_pct                = COALESCE((p_dados->>'bdi_lucro_pct')::numeric, c.bdi_lucro_pct),
    bdi_impostos_pct             = COALESCE((p_dados->>'bdi_impostos_pct')::numeric, c.bdi_impostos_pct),
    margem_alvo_pct              = COALESCE((p_dados->>'margem_alvo_pct')::numeric, c.margem_alvo_pct),
    margem_minima_pct            = COALESCE((p_dados->>'margem_minima_pct')::numeric, c.margem_minima_pct),
    validade_proposta_dias       = COALESCE((p_dados->>'validade_proposta_dias')::int, c.validade_proposta_dias),
    prazo_pagamento_padrao_dias  = COALESCE((p_dados->>'prazo_pagamento_padrao_dias')::int, c.prazo_pagamento_padrao_dias),
    dias_uteis_mes               = COALESCE((p_dados->>'dias_uteis_mes')::int, c.dias_uteis_mes),
    prefixo_orcamento            = COALESCE(NULLIF(upper(btrim(p_dados->>'prefixo_orcamento')), ''), c.prefixo_orcamento),
    prefixo_obra                 = COALESCE(NULLIF(upper(btrim(p_dados->>'prefixo_obra')), ''), c.prefixo_obra),
    prefixo_proposta             = COALESCE(NULLIF(upper(btrim(p_dados->>'prefixo_proposta')), ''), c.prefixo_proposta),
    vendedor_pode_alterar_preco    = COALESCE((p_dados->>'vendedor_pode_alterar_preco')::boolean, c.vendedor_pode_alterar_preco),
    vendedor_pode_aprovar_proposta = COALESCE((p_dados->>'vendedor_pode_aprovar_proposta')::boolean, c.vendedor_pode_aprovar_proposta),
    updated_at = now()
  WHERE c.company_id = p_company_id;

  UPDATE projetos_modulo_config c SET
    bdi_total_pct = CASE
      WHEN c.bdi_impostos_pct < 100 THEN round(
        ((1 + (c.bdi_admin_central_pct + c.bdi_seguros_pct + c.bdi_riscos_pct + c.bdi_garantias_pct)/100)
         * (1 + c.bdi_despesas_financeiras_pct/100)
         * (1 + c.bdi_lucro_pct/100)
         / (1 - c.bdi_impostos_pct/100) - 1) * 100, 2)
      ELSE 0 END
  WHERE c.company_id = p_company_id
  RETURNING c.* INTO v_row;

  IF auth.uid() IS NOT NULL AND (to_jsonb(v_old) - 'updated_at') IS DISTINCT FROM (to_jsonb(v_row) - 'updated_at') THEN
    INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
      VALUES (p_company_id, auth.uid(), 'projetos_modulo_config', p_company_id, 'config_alterada',
              to_jsonb(v_old) - 'updated_at', to_jsonb(v_row) - 'updated_at');
  END IF;

  RETURN to_jsonb(v_row);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_config_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_config_salvar(uuid, jsonb) TO authenticated, service_role;

-- 4) Ajuda RD-95 dos campos novos (idempotente)
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem) VALUES
  ('projetos.catalogo.bom.observacao', '/dashboard/projetos/catalogo/[id]', 'BOM', 'Observação do cálculo',
   'Em texto livre, como você chegou nesse consumo/quantidade do item.',
   'Deixa a conta explícita para quem revisar o custo depois. Quando você usa o "Calcular consumo", ela é preenchida sozinha com a fórmula (e pode editar).',
   '1 protetor por pessoa x 7 pessoas, dura 6 meses; coeficiente = itens / m2 produzidos em 6 meses.',
   'Deixar vazio num item calculado — perde o rastro de como o número saiu.', 'projetos', 60),
  ('projetos.catalogo.bom.metodo_coeficiente', '/dashboard/projetos/catalogo/[id]', 'BOM', 'Como calcular o consumo',
   'Escolha como o consumo por unidade (ex.: por m2) é obtido: Direto (digita), Rendimento (1 un. rende Y), Consumo técnico (ficha do fabricante), Vida útil/período, ou Por pessoa x tempo.',
   'Calcula o coeficiente (Qtd) e o custo por unidade automaticamente e preenche a observação com a conta. "Direto" mantém o comportamento de sempre (você digita a Qtd).',
   'EPI que dura 6 meses -> Vida útil/período; tinta 1,2 kg/m2 -> Consumo técnico.',
   'Usar período sem informar a produtividade do serviço (m2/dia) — sem ela o cálculo por período não fecha.', 'projetos', 61),
  ('projetos.catalogo.bom.periodo', '/dashboard/projetos/catalogo/[id]', 'BOM', 'Período de utilização (vida útil)',
   'Quanto tempo o item dura/é usado: um número + a unidade (dias, horas ou meses).',
   'Base dos métodos por período: divide a quantidade usada no período pelos m2 produzidos no mesmo período (produtividade x dias úteis). Horas viram dias pela jornada.',
   'Protetor auricular: 6 meses.',
   'Confundir vida útil (quanto dura) com quantidade por período.', 'projetos', 62),
  ('projetos.catalogo.bom.qtd_por_periodo', '/dashboard/projetos/catalogo/[id]', 'BOM', 'Quantidade por período',
   'Quantos itens são consumidos no período informado — no total, ou por pessoa (no método "Por pessoa x tempo").',
   'Numerador do cálculo por período. No "Por pessoa x tempo" é multiplicado pelo nº de pessoas da equipe.',
   '1 por pessoa (protetor); 2 no total (rolos de fita no mês).',
   'Informar por pessoa mas escolher o método total (ou o contrário).', 'projetos', 63),
  ('projetos.config.dias_uteis_mes', '/dashboard/projetos/configuracoes', 'Produtividade', 'Dias úteis por mês',
   'Quantos dias a equipe efetivamente trabalha no mês (padrão 22).',
   'Converte vida útil em meses para dias produtivos no cálculo de consumo por período. Ajuste se a jornada da sua empresa for diferente.',
   '22 (padrão); 20 se houver mais paradas.',
   'Usar 30 (dias corridos) — infla os m2 do período e derruba o coeficiente.', 'projetos', 64)
ON CONFLICT (chave) DO NOTHING;
