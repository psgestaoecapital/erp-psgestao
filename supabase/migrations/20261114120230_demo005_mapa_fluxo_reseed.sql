-- Auditor PDCA · /dashboard/produtividade/mapa (gap: DEMO 005 abre em "Nenhuma raia
-- ainda", critérios b/c da jornada não verificáveis sem dado).
--
-- A migration 20261113222010_prod_fluxo_demo005_linha_abate_desossa.sql já semeava o
-- fluxo, mas rodou ANTES dos setores Abate/Desossa existirem na planta DEMO (ordenação
-- do deploy): o guard RETURN'd cedo, nada foi inserido e, por já estar no ledger, não
-- re-roda. Hoje a planta DEMO Indústria (005) tem setores (Abate, Desossa), 11 postos
-- ativos e os produtos BOV-001..BOV-400 — tudo que o seed precisa (conferido no dado,
-- RD-38). O reset da DEMO NÃO apaga prod_setor/prod_posto/prod_produto e as FKs de
-- prod_fluxo são ON DELETE RESTRICT, então o fluxo semeado agora SOBREVIVE aos resets.
--
-- Esta migration re-executa o MESMO bloco idempotente (corpo verbatim do seed original),
-- agora com as precondições satisfeitas, dando ao Mapa do fluxo da DEMO:
--   • 2 raias (prod_fluxo): "Linha de Abate" (setor Abate) e "Linha de Desossa"
--     (setor Desossa), modo compartilhado, direção desmontagem;
--   • etapas (prod_fluxo_etapa) = os postos ativos de cada setor, em ordem pela
--     numeração (tipo manual; controle SIF na Inspeção oficial);
--   • rendimento do caminho (prod_estrutura): Abate BOV-001 (boi) → BOV-010 (carcaça)
--     54%; Desossa carcaça → BOV-100 dianteiro 48% (principal), BOV-202 coxão mole 9%
--     e BOV-204 picanha 2% (coprodutos), BOV-400 sebo/ossos 12% (subproduto).
--
-- ADITIVA e IDEMPOTENTE: raia por (empresa/planta/nome), etapa por (fluxo/posto) e
-- rendimento por (fluxo/origem/produto) só se ainda não existirem (reimportar não
-- duplica — provado em BEGIN/ROLLBACK: 2 raias / 11 etapas / 5 rendimentos; rodar de
-- novo mantém a mesma contagem). Guarda is_demo: NUNCA roda em dado de cliente (RD-69).
-- Sem DDL, sem RLS/grant/RPC; usa só tabelas já existentes (prod_fluxo/prod_fluxo_etapa/
-- prod_estrutura), que já têm RLS por company_id. Não varre tabela grande nem chama
-- função por linha em volume.

DO $$
DECLARE
  v_company uuid := 'b0700000-0000-4000-a000-000000000005';
  v_plant   uuid := '49a0d5ae-c5f8-4969-a40e-46f800f1a2a1';
  v_abate uuid; v_desossa uuid; v_fab uuid; v_fde uuid;
  v_boi uuid; v_carc uuid; v_dia uuid; v_coxao uuid; v_pic uuid; v_sebo uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_company AND is_demo IS TRUE) THEN
    RAISE NOTICE 'Empresa DEMO Indústria (005) ausente ou não-DEMO — seed de fluxo ignorado';
    RETURN;
  END IF;

  SELECT id INTO v_abate   FROM prod_setor WHERE company_id = v_company AND nome ILIKE 'Abate%'   LIMIT 1;
  SELECT id INTO v_desossa FROM prod_setor WHERE company_id = v_company AND nome ILIKE 'Desossa%' LIMIT 1;
  IF v_abate IS NULL OR v_desossa IS NULL THEN
    RAISE NOTICE 'Setores Abate/Desossa da DEMO ausentes — seed de fluxo ignorado';
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

  -- 2) etapas = postos do setor, em ordem pela numeração (idempotente por fluxo/posto)
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

  -- 3) rendimento do caminho (entra/sai por raia) — idempotente por fluxo/origem/produto
  SELECT id INTO v_boi   FROM prod_produto WHERE company_id = v_company AND plant_id = v_plant AND codigo = 'BOV-001';
  SELECT id INTO v_carc  FROM prod_produto WHERE company_id = v_company AND plant_id = v_plant AND codigo = 'BOV-010';
  SELECT id INTO v_dia   FROM prod_produto WHERE company_id = v_company AND plant_id = v_plant AND codigo = 'BOV-100';
  SELECT id INTO v_coxao FROM prod_produto WHERE company_id = v_company AND plant_id = v_plant AND codigo = 'BOV-202';
  SELECT id INTO v_pic   FROM prod_produto WHERE company_id = v_company AND plant_id = v_plant AND codigo = 'BOV-204';
  SELECT id INTO v_sebo  FROM prod_produto WHERE company_id = v_company AND plant_id = v_plant AND codigo = 'BOV-400';

  INSERT INTO prod_estrutura(company_id, plant_id, fluxo_id, origem_produto_id, produto_id, tipo_saida, rendimento_padrao_pct, status, vigencia_inicio, ativo)
  SELECT s.a, s.b, s.c, s.d, s.e, s.f, s.g, s.h, s.i, s.j
    FROM (VALUES
      (v_company, v_plant, v_fab, v_boi,  v_carc,  'principal',  54.0, 'validado', CURRENT_DATE, true),
      (v_company, v_plant, v_fde, v_carc, v_dia,   'principal',  48.0, 'validado', CURRENT_DATE, true),
      (v_company, v_plant, v_fde, v_carc, v_coxao, 'coproduto',   9.0, 'validado', CURRENT_DATE, true),
      (v_company, v_plant, v_fde, v_carc, v_pic,   'coproduto',   2.0, 'validado', CURRENT_DATE, true),
      (v_company, v_plant, v_fde, v_carc, v_sebo,  'subproduto', 12.0, 'validado', CURRENT_DATE, true)
    ) s(a, b, c, d, e, f, g, h, i, j)
   WHERE s.d IS NOT NULL AND s.e IS NOT NULL AND s.d <> s.e
     AND NOT EXISTS (SELECT 1 FROM prod_estrutura x WHERE x.fluxo_id = s.c AND x.origem_produto_id = s.d AND x.produto_id = s.e AND x.ativo);
END $$;
