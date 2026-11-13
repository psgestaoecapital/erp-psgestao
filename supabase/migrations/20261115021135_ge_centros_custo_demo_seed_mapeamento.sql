-- Seed DEMO (aditivo, idempotente) — auditoria PDCA GE, tela /dashboard/gestao-empresarial/centros-custo.
--
-- Contexto: a empresa DEMO "Comercio GE LTDA" (b0700000-0000-4000-a000-000000000004) tem 3 centros de
-- custo reais nos lancamentos (COMERCIAL, PROJETO_X, ADMIN), porem 0 linhas em cost_center_map e apenas
-- 1 linha de negocio ("Geral"). Com isso a tela de Centros de Custo mostra os 3 como "nao mapeado" e o
-- elo centro -> linha de negocio nao fica demonstravel no DEMO.
--
-- Esta migration SEMEIA apenas o que falta, sem nunca sobrescrever mapeamento existente:
--   1) 2a linha de negocio "Comercial" (so se ainda nao houver uma com esse nome);
--   2) mapeia os 3 centros em cost_center_map (so os ainda NAO mapeados), espelhando o contrato do
--      RPC guardado fn_centro_custo_mapear (allocation_pct=100, cost_scope='todos', priority=0, ativo):
--        - COMERCIAL -> direto -> linha "Comercial"
--        - PROJETO_X -> direto -> linha "Geral"
--        - ADMIN     -> comum  -> rateado (business_line_id NULL)
--   3) garante os centros em erp_centros_custo (como faz o RPC), para aparecerem ao lancar.
--
-- Escopo: SOMENTE a empresa DEMO acima. Nao toca dado de cliente. Nao altera funcao/RLS/grant.
-- fn_demo_reset e os seeders GE NAO tocam cost_center_map/business_lines/erp_centros_custo (verificado),
-- entao o seed e duravel entre resets.

DO $$
DECLARE
  v_company uuid := 'b0700000-0000-4000-a000-000000000004';
  v_bl_geral uuid;
  v_bl_comercial uuid;
BEGIN
  -- guarda: so age se a empresa DEMO existir
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_company) THEN
    RAISE NOTICE 'empresa DEMO ausente; seed ignorado'; RETURN;
  END IF;

  -- 1) 2a linha de negocio "Comercial" (idempotente por company + nome)
  SELECT id INTO v_bl_geral     FROM business_lines WHERE company_id = v_company AND ln_number = 1 LIMIT 1;
  SELECT id INTO v_bl_comercial FROM business_lines WHERE company_id = v_company AND lower(name) = 'comercial' LIMIT 1;
  IF v_bl_comercial IS NULL THEN
    INSERT INTO business_lines (company_id, ln_number, name, type, is_active)
    VALUES (v_company,
            COALESCE((SELECT max(ln_number) FROM business_lines WHERE company_id = v_company), 0) + 1,
            'Comercial', 'comercio', true)
    RETURNING id INTO v_bl_comercial;
  END IF;

  -- 2) mapeamentos — somente centro ainda NAO mapeado (nunca sobrescreve regra viva do usuario)
  IF NOT EXISTS (SELECT 1 FROM cost_center_map WHERE company_id = v_company AND source_type = 'centro_custo' AND source_key = 'COMERCIAL') THEN
    INSERT INTO cost_center_map (company_id, source_type, source_key, business_line_id, tipo_apropriacao, allocation_pct, cost_scope, priority, ativo)
    VALUES (v_company, 'centro_custo', 'COMERCIAL', v_bl_comercial, 'direto', 100, 'todos', 0, true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cost_center_map WHERE company_id = v_company AND source_type = 'centro_custo' AND source_key = 'PROJETO_X') THEN
    INSERT INTO cost_center_map (company_id, source_type, source_key, business_line_id, tipo_apropriacao, allocation_pct, cost_scope, priority, ativo)
    VALUES (v_company, 'centro_custo', 'PROJETO_X', v_bl_geral, 'direto', 100, 'todos', 0, true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cost_center_map WHERE company_id = v_company AND source_type = 'centro_custo' AND source_key = 'ADMIN') THEN
    INSERT INTO cost_center_map (company_id, source_type, source_key, business_line_id, tipo_apropriacao, allocation_pct, cost_scope, priority, ativo)
    VALUES (v_company, 'centro_custo', 'ADMIN', NULL, 'comum', 100, 'todos', 0, true);
  END IF;

  -- 3) centros visiveis ao lancar (erp_centros_custo), espelhando o RPC
  INSERT INTO erp_centros_custo (company_id, nome, codigo, ativo)
  SELECT v_company, c, c, true
  FROM (VALUES ('COMERCIAL'), ('PROJETO_X'), ('ADMIN')) t(c)
  WHERE NOT EXISTS (SELECT 1 FROM erp_centros_custo e WHERE e.company_id = v_company AND e.nome = t.c);
END $$;
