-- PDCA GE · /dashboard/gestao-empresarial/centros-custo · item 2 (auditor_pdca_2, 11/11)
-- Semeia, de forma IDEMPOTENTE e SÓ na DEMO GE ("Comercio GE LTDA"), o elo
--   centros-custo -> rateio -> resultado-por-negocio (Princ.4), para a jornada ficar demonstrável:
--     - 2ª linha de negócio "Comercial" (além de "Geral");
--     - mapeamento dos 3 centros de custo reais da DEMO:
--         COMERCIAL -> DIRETO na linha Comercial
--         PROJETO_X -> DIRETO na linha Geral
--         ADMIN     -> COMUM (rateável por todas as linhas)
--
-- ADITIVO / IDEMPOTENTE. Não altera nem apaga dado de cliente: escopo preso ao uuid da DEMO GE
-- (faixa b07..., empresa de demonstração) e guardado por EXISTS em public.companies.
-- Durável: fn_demo_reset NÃO toca cost_center_map/business_lines (provado RD-38), então as linhas
-- semeadas persistem ao reset; esta migration apenas CODIFICA o estado para ambientes novos/limpos.
-- Prova RD-38 (BEGIN..ROLLBACK): povoado => maps=3/bls=2 sem duplicar; vazio => converge p/ 3 maps.
-- Code: code-desenvolvedor-3
DO $$
DECLARE
  v_company      uuid := 'b0700000-0000-4000-a000-000000000004'; -- DEMO "Comercio GE LTDA"
  v_bl_geral     uuid;
  v_bl_comercial uuid;
  v_next_ln      int;
BEGIN
  -- guarda: só roda se a empresa de demonstração existir
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_company) THEN
    RAISE NOTICE 'DEMO GE % ausente; seed de centros-custo ignorado', v_company;
    RETURN;
  END IF;

  SELECT id INTO v_bl_geral
    FROM public.business_lines
   WHERE company_id = v_company AND lower(name) = 'geral'
   ORDER BY ln_number LIMIT 1;

  SELECT id INTO v_bl_comercial
    FROM public.business_lines
   WHERE company_id = v_company AND lower(name) = 'comercial'
   ORDER BY ln_number LIMIT 1;

  -- 2ª linha de negócio "Comercial" (se ainda não existir)
  IF v_bl_comercial IS NULL THEN
    SELECT COALESCE(max(ln_number), 0) + 1 INTO v_next_ln
      FROM public.business_lines WHERE company_id = v_company;
    INSERT INTO public.business_lines(id, company_id, ln_number, name, type, is_active, descricao)
    VALUES (gen_random_uuid(), v_company, v_next_ln, 'Comercial', 'comercio', true,
            'Linha de negócio comercial (seed DEMO para demonstrar rateio por negócio).')
    RETURNING id INTO v_bl_comercial;
  END IF;

  -- mapeamento dos 3 centros (idempotente por company_id + source_type + source_key)
  INSERT INTO public.cost_center_map(id, company_id, source_type, source_key,
         business_line_id, allocation_pct, cost_scope, priority, ativo, tipo_apropriacao)
  SELECT gen_random_uuid(), v_company, 'centro_custo', 'COMERCIAL',
         v_bl_comercial, 100.00, 'todos', 0, true, 'direto'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.cost_center_map
     WHERE company_id = v_company AND source_type = 'centro_custo' AND source_key = 'COMERCIAL');

  INSERT INTO public.cost_center_map(id, company_id, source_type, source_key,
         business_line_id, allocation_pct, cost_scope, priority, ativo, tipo_apropriacao)
  SELECT gen_random_uuid(), v_company, 'centro_custo', 'PROJETO_X',
         v_bl_geral, 100.00, 'todos', 0, true, 'direto'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.cost_center_map
     WHERE company_id = v_company AND source_type = 'centro_custo' AND source_key = 'PROJETO_X');

  INSERT INTO public.cost_center_map(id, company_id, source_type, source_key,
         business_line_id, allocation_pct, cost_scope, priority, ativo, tipo_apropriacao)
  SELECT gen_random_uuid(), v_company, 'centro_custo', 'ADMIN',
         NULL, 100.00, 'todos', 0, true, 'comum'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.cost_center_map
     WHERE company_id = v_company AND source_type = 'centro_custo' AND source_key = 'ADMIN');
END $$;
