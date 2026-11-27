-- DEMO-SEED (SÓ-DEMO) · /dashboard/gestao-empresarial/resultado-por-negocio (PDCA auditor_pdca_2, onda 69 · 27/11).
-- PROBLEMA (RD-38): a tela calcula certo, mas na DEMO GE o relatório carro-chefe fica irreal — custos=0 nas 5 linhas
-- (Geral, Comercial, Varejo, Atacado, Serviços), porque quase nenhum título a PAGAR está classificado por
-- centro_custo/plano-de-contas. A RECEITA por linha já existe (erp_receber.linha_negocio cobre as 5), então as
-- margens saíam ~-1300%. fn_ge_resultado_por_negocio_calc classifica o pagar por cost_center_map (centro_custo →
-- business_line) e lê o grupo do DRE pelo tipo da conta (plano de contas: tipo='custo' → CMV → linha "custos").
--
-- SOLUÇÃO (ADITIVA, idempotente, SÓ-DEMO): (1) completa o cost_center_map com os 3 centros que faltavam
-- (Varejo/Atacado/Serviços — Comercial e Geral já existiam); (2) semeia um conjunto REPRESENTATIVO de custos reais
-- por linha (2 títulos a pagar por negócio, em 2026-09, o mês de maior receita), com valores ~50-60% da receita do mês
-- para dar margens plausíveis. NÃO reclassifica nem apaga nenhum título existente (os R$312k de "Financiamento" e os
-- lançamentos ambíguos ficam intactos). Guardado por companies.is_demo = true E pelo id da DEMO GE (b0700000-…0004).
-- Ids determinísticos na família b0700000- → re-rodar não duplica (ON CONFLICT / NOT EXISTS). RD-52: arquivo + PR.
--
-- data_competencia dos títulos antigos sem competência: a função já usa coalesce(data_competencia, data_emissao), ou
-- seja, eles JÁ entram no regime de competência pela emissão — é fallback correto, não precisa reescrever dado do DEMO.

DO $seed$
DECLARE
  v_cid uuid := 'b0700000-0000-4000-a000-000000000004';
  v_scope text;
  v_bl_geral uuid; v_bl_comercial uuid; v_bl_varejo uuid; v_bl_atacado uuid; v_bl_servicos uuid;
BEGIN
  -- Trava SÓ-DEMO: só age se a empresa existir e for DEMO.
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_cid AND is_demo = true) THEN
    RAISE NOTICE 'DEMO GE (%) ausente ou não-demo: seed ignorado.', v_cid;
    RETURN;
  END IF;

  SELECT id INTO v_bl_geral     FROM public.business_lines WHERE company_id = v_cid AND lower(name) = 'geral'     AND is_active;
  SELECT id INTO v_bl_comercial FROM public.business_lines WHERE company_id = v_cid AND lower(name) = 'comercial' AND is_active;
  SELECT id INTO v_bl_varejo    FROM public.business_lines WHERE company_id = v_cid AND lower(name) = 'varejo'    AND is_active;
  SELECT id INTO v_bl_atacado   FROM public.business_lines WHERE company_id = v_cid AND lower(name) = 'atacado'   AND is_active;
  SELECT id INTO v_bl_servicos  FROM public.business_lines WHERE company_id = v_cid AND lower(name) = 'serviços'  AND is_active;

  -- cost_scope espelhado de uma regra existente (a UNIQUE inclui cost_scope).
  SELECT cost_scope INTO v_scope FROM public.cost_center_map
   WHERE company_id = v_cid AND source_type = 'centro_custo' LIMIT 1;

  -- (1) Regras de centro de custo que faltavam: Varejo/Atacado/Serviços (direto, 100%). Idempotente por NOT EXISTS.
  INSERT INTO public.cost_center_map (company_id, source_type, source_key, business_line_id, allocation_pct, tipo_apropriacao, cost_scope, ativo)
  SELECT v_cid, 'centro_custo', x.key, x.bl, 100, 'direto', v_scope, true
  FROM (VALUES ('VAREJO', v_bl_varejo), ('ATACADO', v_bl_atacado), ('SERVICOS', v_bl_servicos)) AS x(key, bl)
  WHERE x.bl IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.cost_center_map m
      WHERE m.company_id = v_cid AND m.source_type = 'centro_custo' AND upper(m.source_key) = x.key);

  -- (2) Custos reais por linha (2 títulos a pagar por negócio, competência 2026-09). Ids determinísticos DEMO.
  -- centro_custo casa a regra do cost_center_map; categoria = conta tipo 'custo' (→ CMV → linha "custos" no cálculo).
  INSERT INTO public.erp_pagar
    (id, company_id, descricao, fornecedor_nome, valor, categoria, centro_custo,
     data_emissao, data_competencia, data_vencimento, status)
  SELECT s.id, v_cid, s.descricao, s.fornecedor, s.valor, s.categoria, s.centro,
         DATE '2026-09-05', DATE '2026-09-01', DATE '2026-09-20', 'pago'
  FROM (VALUES
    -- Geral (PROJETO_X) — receita set ~2.360/mês
    ('b0700000-0000-4000-a000-000000900001'::uuid, 'Insumos gerais — rateio operacional (DEMO)',      'Fornecedor Geral DEMO',      820.00, '2.01.03', 'PROJETO_X'),
    ('b0700000-0000-4000-a000-000000900002'::uuid, 'Materiais de apoio — operação (DEMO)',             'Suprimentos DEMO',           480.00, '2.01.02', 'PROJETO_X'),
    -- Comercial — receita ~3.886/mês
    ('b0700000-0000-4000-a000-000000900003'::uuid, 'Mercadoria para revenda — Comercial (DEMO)',       'Distribuidora Comercial DEMO',1550.00,'2.01.02', 'COMERCIAL'),
    ('b0700000-0000-4000-a000-000000900004'::uuid, 'Embalagens de expedição — Comercial (DEMO)',       'Embalagens DEMO',            560.00, '2.01.04', 'COMERCIAL'),
    -- Varejo — receita ~2.760/mês
    ('b0700000-0000-4000-a000-000000900005'::uuid, 'Mercadoria para revenda — Varejo (DEMO)',          'Atacadista Varejo DEMO',    1180.00, '2.01.02', 'VAREJO'),
    ('b0700000-0000-4000-a000-000000900006'::uuid, 'Insumos de loja — Varejo (DEMO)',                  'Fornecedor Varejo DEMO',     360.00, '2.01.03', 'VAREJO'),
    -- Atacado — receita ~1.625/mês
    ('b0700000-0000-4000-a000-000000900007'::uuid, 'Mercadoria para revenda — Atacado (DEMO)',         'Indústria Atacado DEMO',     760.00, '2.01.02', 'ATACADO'),
    ('b0700000-0000-4000-a000-000000900008'::uuid, 'Frete de compra — Atacado (DEMO)',                 'Transportadora DEMO',        220.00, '2.01.03', 'ATACADO'),
    -- Serviços — receita ~1.460/mês (custo = mão de obra/terceirização)
    ('b0700000-0000-4000-a000-000000900009'::uuid, 'Terceirização de execução — Serviços (DEMO)',      'Equipe Terceirizada DEMO',   640.00, '2.02.03', 'SERVICOS'),
    ('b0700000-0000-4000-a000-000000900010'::uuid, 'Materiais aplicados — Serviços (DEMO)',            'Fornecedor Serviços DEMO',   180.00, '2.01.03', 'SERVICOS')
  ) AS s(id, descricao, fornecedor, valor, categoria, centro)
  ON CONFLICT (id) DO NOTHING;
END
$seed$;
