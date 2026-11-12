-- PDCA · /dashboard/produtividade/apontamento (e Mapa) — DEMO Indústria (005) estava com 0 fluxos (prod_fluxo),
-- então a tela de Apontamento abria em "Nenhum fluxo cadastrado nesta planta" e a jornada (apontar produção) não
-- era exercitável (RD-38). A migration 20261113222010 já tinha a lógica do seed, mas RODOU ANTES dos setores
-- Abate/Desossa existirem na DEMO e saiu cedo (RETURN) — e, por ser idempotente, não voltou a rodar. Os setores,
-- postos e produtos já existem agora; este reparo cria as raias e etapas que faltaram.
--
-- Diferença para a 222010 (RD-38, evitar duplicar): as 5 linhas de prod_estrutura da DEMO JÁ EXISTEM com
-- fluxo_id NULL (vieram de outro seed). Em vez de INSERIR estrutura de novo (o que duplicaria origem→saída), este
-- reparo apenas LIGA cada linha existente à sua raia (UPDATE só onde fluxo_id IS NULL). Assim o Mapa passa a
-- mostrar o entra/sai por raia sem dobrar o rendimento.
--
-- ADITIVO e IDEMPOTENTE: raia por (empresa/planta/nome), etapa por (fluxo/posto), estrutura ligada só se ainda
-- estiver sem raia. Guarda is_demo (RD-69): NUNCA roda em dado de cliente. Sem DDL, sem RLS/grant/RPC. Usa só
-- tabelas já existentes (prod_fluxo/prod_fluxo_etapa/prod_estrutura/prod_posto/prod_setor), todas com RLS por
-- empresa. Faixa de segundos do dev7claudeps (:10), acima do ledger (renumerada de :15 — a versão anterior
-- 20261114130015 caiu fora da janela de 2 dias do check 1b quando o run rodou cedo; conteúdo idêntico).

DO $$
DECLARE
  v_company uuid := 'b0700000-0000-4000-a000-000000000005';
  v_plant   uuid := '49a0d5ae-c5f8-4969-a40e-46f800f1a2a1';
  v_abate uuid; v_desossa uuid; v_fab uuid; v_fde uuid;
  v_boi uuid; v_carc uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_company AND is_demo IS TRUE) THEN
    RAISE NOTICE 'Empresa DEMO Indústria (005) ausente ou não-DEMO — reparo de fluxo ignorado (RD-69)';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM industrial_plants WHERE id = v_plant AND company_id = v_company) THEN
    RAISE NOTICE 'Planta DEMO ausente — reparo de fluxo ignorado';
    RETURN;
  END IF;

  SELECT id INTO v_abate   FROM prod_setor WHERE company_id = v_company AND nome ILIKE 'Abate%'   LIMIT 1;
  SELECT id INTO v_desossa FROM prod_setor WHERE company_id = v_company AND nome ILIKE 'Desossa%' LIMIT 1;
  IF v_abate IS NULL OR v_desossa IS NULL THEN
    RAISE NOTICE 'Setores Abate/Desossa da DEMO ausentes — reparo de fluxo ignorado';
    RETURN;
  END IF;

  -- 1) raias (idempotente por empresa/planta/nome)
  SELECT id INTO v_fab FROM prod_fluxo
   WHERE company_id = v_company AND plant_id = v_plant AND nome = 'Linha de Abate' AND deleted_at IS NULL;
  IF v_fab IS NULL THEN
    INSERT INTO prod_fluxo(company_id, plant_id, setor_id, nome, modo, direcao, ordem, ativo)
    VALUES (v_company, v_plant, v_abate, 'Linha de Abate', 'compartilhado', 'desmontagem', 1, true)
    RETURNING id INTO v_fab;
  END IF;
  SELECT id INTO v_fde FROM prod_fluxo
   WHERE company_id = v_company AND plant_id = v_plant AND nome = 'Linha de Desossa' AND deleted_at IS NULL;
  IF v_fde IS NULL THEN
    INSERT INTO prod_fluxo(company_id, plant_id, setor_id, nome, modo, direcao, ordem, ativo)
    VALUES (v_company, v_plant, v_desossa, 'Linha de Desossa', 'compartilhado', 'desmontagem', 2, true)
    RETURNING id INTO v_fde;
  END IF;

  -- 2) etapas = postos ativos do setor, em ordem pela numeração (idempotente por fluxo/posto)
  INSERT INTO prod_fluxo_etapa(company_id, plant_id, fluxo_id, posto_id, ordem, nome, tipo, tempo_ciclo_seg, pessoas, controle_sif)
  SELECT v_company, v_plant, v_fab, p.id, (p.numero)::int, p.atividade, 'manual', 45, 2, (p.atividade ILIKE '%Inspe%')
    FROM prod_posto p
   WHERE p.company_id = v_company AND p.setor_id = v_abate AND p.ativo
     AND NOT EXISTS (SELECT 1 FROM prod_fluxo_etapa e WHERE e.fluxo_id = v_fab AND e.posto_id = p.id AND e.deleted_at IS NULL);
  INSERT INTO prod_fluxo_etapa(company_id, plant_id, fluxo_id, posto_id, ordem, nome, tipo, tempo_ciclo_seg, pessoas, controle_sif)
  SELECT v_company, v_plant, v_fde, p.id, (p.numero)::int, p.atividade, 'manual', 60, 3, false
    FROM prod_posto p
   WHERE p.company_id = v_company AND p.setor_id = v_desossa AND p.ativo
     AND NOT EXISTS (SELECT 1 FROM prod_fluxo_etapa e WHERE e.fluxo_id = v_fde AND e.posto_id = p.id AND e.deleted_at IS NULL);

  -- 3) LIGA a estrutura existente (fluxo_id NULL) à sua raia — sem inserir (não duplica origem→saída)
  SELECT id INTO v_boi  FROM prod_produto WHERE company_id = v_company AND plant_id = v_plant AND codigo = 'BOV-001';
  SELECT id INTO v_carc FROM prod_produto WHERE company_id = v_company AND plant_id = v_plant AND codigo = 'BOV-010';
  IF v_boi IS NOT NULL THEN
    UPDATE prod_estrutura SET fluxo_id = v_fab, updated_at = now()
     WHERE company_id = v_company AND plant_id = v_plant AND origem_produto_id = v_boi AND fluxo_id IS NULL;
  END IF;
  IF v_carc IS NOT NULL THEN
    UPDATE prod_estrutura SET fluxo_id = v_fde, updated_at = now()
     WHERE company_id = v_company AND plant_id = v_plant AND origem_produto_id = v_carc AND fluxo_id IS NULL;
  END IF;

  RAISE NOTICE 'DEMO fluxo reparado: abate %, desossa %', v_fab, v_fde;
END $$;
