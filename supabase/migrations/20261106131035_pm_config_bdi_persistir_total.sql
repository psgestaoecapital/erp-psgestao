-- Chamado #3362 (auditoria PDCA, /dashboard/projetos/configuracoes · Hub Projetos):
-- "frontend mostra 36,58% mas backend 0,00% — dessincronia de dado".
--
-- CAUSA (provado no dado RD-38): a tela calcula o BDI ao vivo pela fórmula AEC
-- (TCU/SINAPI) mas o backend NUNCA persistia o total — fn_projetos_config_salvar
-- gravava os componentes e deixava bdi_total_pct NULL/0 (sem gatilho, sem default).
-- O comentário "trigger backend recalcula" era obsoleto: não existe trigger em
-- projetos_modulo_config. Em empresa sem linha gravada (ex.: DEMO) o backend reporta
-- 0,00% enquanto a tela mostra 36,58% (defaults). Além disso o card "Impacto nos
-- Serviços" fica vazio sem serviços cadastrados.
--
-- CORREÇÃO (aditiva, idempotente):
--  1) fn_projetos_config_salvar passa a RECALCULAR e PERSISTIR bdi_total_pct pela
--     mesma fórmula AEC exibida na tela, a cada gravação. (CREATE OR REPLACE —
--     função existente de cálculo = SENSÍVEL, revisao-eng-chefe.)
--  2) Backfill idempotente dos totais de linhas já existentes que estejam
--     NULL/0/divergentes (sem tocar linhas já corretas).
--  3) Seed da DEMO (Construtora Modelo b0700000-…0002): linha de config com os
--     defaults da tela (impostos 9,25% → BDI 36,58%) + 3 serviços reais, para o card
--     "Impacto nos Serviços" refletir dado de verdade. ON CONFLICT DO NOTHING.
--
-- Fórmula AEC: BDI = ((1+AC+SG+RI+GA)*(1+DF)*(1+LU))/(1-IM) - 1  (tudo em fração, ×100)
--
-- PROVA RD-38 (BEGIN…ROLLBACK em produção, timeout curto):
--  backend_total = 36.58 (igual à tela); v_projetos_bdi_impacto devolve os 3
--  serviços com preço/ margem/ status. Nenhuma linha de cliente alterada.
--
-- Code: code-desenvolvedor-3

-- 1) RPC: recalcula e persiste o BDI total (fórmula AEC) ---------------------------
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

  -- Percentuais: 0 a 100; impostos abaixo de 100 (a fórmula divide por 1 - IM).
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

  INSERT INTO projetos_modulo_config (company_id) VALUES (p_company_id) ON CONFLICT (company_id) DO NOTHING;

  SELECT * INTO v_old FROM projetos_modulo_config WHERE company_id = p_company_id;

  -- Só as chaves enviadas mudam; ausente ou nulo mantém o valor atual.
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
    prefixo_orcamento            = COALESCE(NULLIF(upper(btrim(p_dados->>'prefixo_orcamento')), ''), c.prefixo_orcamento),
    prefixo_obra                 = COALESCE(NULLIF(upper(btrim(p_dados->>'prefixo_obra')), ''), c.prefixo_obra),
    prefixo_proposta             = COALESCE(NULLIF(upper(btrim(p_dados->>'prefixo_proposta')), ''), c.prefixo_proposta),
    vendedor_pode_alterar_preco    = COALESCE((p_dados->>'vendedor_pode_alterar_preco')::boolean, c.vendedor_pode_alterar_preco),
    vendedor_pode_aprovar_proposta = COALESCE((p_dados->>'vendedor_pode_aprovar_proposta')::boolean, c.vendedor_pode_aprovar_proposta),
    updated_at = now()
  WHERE c.company_id = p_company_id;

  -- #3362: recalcula e PERSISTE o BDI total pela fórmula AEC (igual ao exibido na tela),
  -- a partir dos componentes já gravados. Nunca deixa 0,00% quando há componentes válidos.
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

  -- RD-98 p4: trilha de QUEM mudou a configuração (BDI/margens/defaults) e QUANDO (antes/depois, menos updated_at).
  IF auth.uid() IS NOT NULL AND (to_jsonb(v_old) - 'updated_at') IS DISTINCT FROM (to_jsonb(v_row) - 'updated_at') THEN
    INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
      VALUES (p_company_id, auth.uid(), 'projetos_modulo_config', p_company_id, 'config_alterada',
              to_jsonb(v_old) - 'updated_at', to_jsonb(v_row) - 'updated_at');
  END IF;

  RETURN to_jsonb(v_row);
END;
$function$;

-- Guarda (check-fn-guards regra 1): função SECURITY DEFINER nunca exposta a anon
-- (valida a empresa internamente via is_admin()/get_user_company_ids()).
REVOKE ALL ON FUNCTION public.fn_projetos_config_salvar(uuid, jsonb) FROM anon;

-- 2) Backfill idempotente dos totais já gravados (só NULL/0/divergentes; não toca linha correta) --
UPDATE public.projetos_modulo_config c SET
  bdi_total_pct = round(
    ((1 + (c.bdi_admin_central_pct + c.bdi_seguros_pct + c.bdi_riscos_pct + c.bdi_garantias_pct)/100)
     * (1 + c.bdi_despesas_financeiras_pct/100)
     * (1 + c.bdi_lucro_pct/100)
     / (1 - c.bdi_impostos_pct/100) - 1) * 100, 2)
WHERE c.bdi_impostos_pct < 100
  AND (
    c.bdi_total_pct IS NULL
    OR c.bdi_total_pct = 0
    OR abs(c.bdi_total_pct - round(
        ((1 + (c.bdi_admin_central_pct + c.bdi_seguros_pct + c.bdi_riscos_pct + c.bdi_garantias_pct)/100)
         * (1 + c.bdi_despesas_financeiras_pct/100)
         * (1 + c.bdi_lucro_pct/100)
         / (1 - c.bdi_impostos_pct/100) - 1) * 100, 2)) > 0.05
  );

-- 3) Seed DEMO (Construtora Modelo) — config + serviços para o card "Impacto nos Serviços" --
DO $seed$
DECLARE
  v_demo uuid := 'b0700000-0000-4000-a000-000000000002';
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = v_demo) THEN
    INSERT INTO public.projetos_modulo_config
      (company_id, bdi_admin_central_pct, bdi_seguros_pct, bdi_riscos_pct, bdi_garantias_pct,
       bdi_despesas_financeiras_pct, bdi_lucro_pct, bdi_impostos_pct, margem_alvo_pct, margem_minima_pct)
    VALUES (v_demo, 5, 1, 1.5, 1, 2, 12, 9.25, 15, 8)
    ON CONFLICT (company_id) DO NOTHING;

    -- garante o total persistido (igual à tela: 36,58%)
    UPDATE public.projetos_modulo_config c SET
      bdi_total_pct = round(
        ((1 + (c.bdi_admin_central_pct + c.bdi_seguros_pct + c.bdi_riscos_pct + c.bdi_garantias_pct)/100)
         * (1 + c.bdi_despesas_financeiras_pct/100)
         * (1 + c.bdi_lucro_pct/100)
         / (1 - c.bdi_impostos_pct/100) - 1) * 100, 2)
    WHERE c.company_id = v_demo AND c.bdi_impostos_pct < 100
      AND (c.bdi_total_pct IS NULL OR c.bdi_total_pct = 0);

    -- idempotente por (company_id, codigo): projetos_servicos não tem constraint única p/ ON CONFLICT
    INSERT INTO public.projetos_servicos
      (company_id, codigo, nome, unidade, custo_material, custo_mao_obra, custo_equipamento, custo_unitario_total, is_publico, ativo)
    SELECT v_demo, x.codigo, x.nome, x.unidade, x.cm, x.cmo, x.ce, x.ctot, false, true
    FROM (VALUES
      ('SRV-DEMO-001','Alvenaria de vedação 14cm','m2',48.00,22.00,0.00,70.00),
      ('SRV-DEMO-002','Contrapiso 5cm','m2',18.00,14.00,3.00,35.00),
      ('SRV-DEMO-003','Pintura látex 2 demãos','m2',9.50,11.00,0.00,20.50)
    ) AS x(codigo,nome,unidade,cm,cmo,ce,ctot)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.projetos_servicos s
      WHERE s.company_id = v_demo AND s.codigo = x.codigo
    );
  END IF;
END
$seed$;
