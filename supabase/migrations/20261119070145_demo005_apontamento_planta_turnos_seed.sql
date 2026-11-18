-- DEMO 005 (Indústria Alimentícia) seed · Apontamento de Produção — Bovinos
-- (/dashboard/industrial/apontamento)
--
-- Gap PDCA aud8 (93/95): a DEMO 005 não tinha nenhuma unidade/planta (ind_unidades=0)
-- nem turno (ind_turnos=0). O form ficava bloqueado no banner "Nenhuma unidade/planta
-- cadastrada" e a lista "Últimos turnos" vazia — a jornada apontar → ver → corrigir →
-- excluir (critérios b/c do PDCA) não era demonstrável de imediato.
--
-- Correção: semeia 1 planta ("Planta Matriz — Abate") e 2 turnos completos (A e B) com
-- apontamento, qualidade SIF e custos preenchidos, de modo que:
--   * o seletor de unidade já vem populado (form liberado sem cadastro prévio);
--   * "Últimos turnos" mostra 2 linhas com Kg produzido e Custo/kg (ações Corrigir/Excluir).
--
-- Segurança / escopo:
--  * SÓ a DEMO 005 (is_demo = true, RD-69) — guard explícito; nenhuma linha de cliente tocada.
--  * Aditiva e IDEMPOTENTE: ids determinísticos + ON CONFLICT / NOT EXISTS; re-rodar é no-op.
--    fn_demo_reset não apaga ind_unidades nem ind_turnos (verificado) → o seed sobrevive ao reset.
--  * Sem DDL, sem RLS/grant/RPC nova. Tabelas já têm RLS por company_id.
--  * RD-38: provado em produção (BEGIN…ROLLBACK) — 2 turnos ativos, Kg/Custo-kg/Margem
--    renderizados pela mesma leitura do GET da tela.

DO $$
DECLARE
  v_company uuid := 'b0700000-0000-4000-a000-000000000005';  -- Indústria Modelo - DEMO (005)
  v_unidade uuid := 'dede0005-0000-4000-a000-000000000001';
  v_t1      uuid := 'dede0005-0000-4000-a000-000000001001';  -- turno A (ontem)
  v_t2      uuid := 'dede0005-0000-4000-a000-000000001002';  -- turno B (anteontem)
BEGIN
  -- RD-69: nunca semear fora de empresa DEMO.
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_company AND is_demo) THEN
    RAISE NOTICE 'Empresa % não é DEMO; seed de apontamento ignorado.', v_company;
    RETURN;
  END IF;

  INSERT INTO ind_unidades (id, company_id, nome, municipio, uf, capacidade_cab_dia, ativa)
  VALUES (v_unidade, v_company, 'Planta Matriz — Abate', 'Chapecó', 'SC', 220, true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO ind_turnos (id, company_id, unidade_id, data, turno)
  VALUES (v_t1, v_company, v_unidade, (current_date - 1), 'A'),
         (v_t2, v_company, v_unidade, (current_date - 2), 'B')
  ON CONFLICT (id) DO NOTHING;

  -- ind_apontamentos_bovinos não tem UNIQUE(turno_id): idempotência por NOT EXISTS.
  INSERT INTO ind_apontamentos_bovinos
    (turno_id, unidade_id, "cabeças_abatidas", peso_total_kg, rendimento_pct, horas_efetivas, meta_cab_turno, paradas_min, operadores)
  SELECT x.turno_id, v_unidade, x.cab, x.kg, x.rend, 8, 200, x.par, x.op
  FROM (VALUES
          (v_t1, 180, 50400, 52.0, 15, 22),
          (v_t2, 165, 46200, 51.3, 25, 21)
       ) AS x(turno_id, cab, kg, rend, par, op)
  WHERE NOT EXISTS (SELECT 1 FROM ind_apontamentos_bovinos a WHERE a.turno_id = x.turno_id);

  INSERT INTO ind_qualidade_sif
    (turno_id, unidade_id, condenados_total, condenados_pct, carcacas_fora_ph, custo_condenacao, causas_json)
  VALUES (v_t1, v_unidade, 3, 1.67, 0, 0, '[]'::jsonb),
         (v_t2, v_unidade, 5, 3.03, 0, 0, '[]'::jsonb)
  ON CONFLICT (turno_id) DO NOTHING;

  -- custo_total é coluna GERADA (não informar).
  INSERT INTO ind_custos_turno
    (turno_id, unidade_id, custo_animal, custo_mo, custo_energia, custo_insumos, custo_outros, custo_por_kg, receita_turno, margem_bruta, kg_produzido)
  VALUES (v_t1, v_unidade, 540000, 18000, 6000, 4000, 0, round(568000.0/50400, 4), 620000, 52000, 50400),
         (v_t2, v_unidade, 495000, 17500, 6200, 4300, 0, round(523000.0/46200, 4), 560000, 37000, 46200)
  ON CONFLICT (turno_id) DO NOTHING;
END $$;
