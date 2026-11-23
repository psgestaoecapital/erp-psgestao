-- Hub · Onda C-2 · tela 315 — SEED do orçamento por EAP na DEMO (RD-98 p1: sem tela morta).
-- Semeia 3 itens de orçamento pela EAP na obra DEMO-FC-001 ("Piso industrial", prestadora FC Pisos),
-- um por local da fábrica (Câmara fria, Expedição, Doca), para a tela 315 mostrar a árvore e o toggle
-- Etapa/Local com dado real. SÓ na empresa DEMO (companies.is_demo = true) e só se o orçamento for dela.
-- Aditivo e idempotente (marcador em observacoes + ON CONFLICT). Não cria/altera estrutura de dados.
-- Code: desenvolvedor_4_g
--
-- Prova RD-38 (BEGIN/ROLLBACK): 3 itens; material R$ 218.687,50; mão de obra R$ 18.750,00; total R$ 237.437,50.

DO $$
DECLARE
  v_company uuid := 'b0700000-0000-4000-a000-000000000006';            -- Construtora Modelo · DEMO (FC Pisos)
  v_orc     uuid := '5a13214a-21b3-43f8-bf5f-2b472cdffc36';            -- orçamento da DEMO-FC-001
  v_serv    uuid := 'b79459c2-c1b4-4b28-bbd3-b6cf07a57583';            -- serviço DEMO com EAP (PSE-08.03.001)
  v_mat     numeric := 874.75;                                         -- custo material unit do serviço
  v_mo      numeric := 75.00;                                          -- custo mão de obra unit do serviço
  v_unit    numeric := 874.75 + 75.00;
  r         record;
  v_item    uuid;
BEGIN
  -- Guarda dura: só roda em empresa DEMO e com o orçamento pertencente a ela (RD-69 / RD-98).
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = v_company AND c.is_demo = true) THEN
    RAISE NOTICE 'empresa % não é DEMO — seed pulado', v_company; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.erp_orcamentos o WHERE o.id = v_orc AND o.company_id = v_company) THEN
    RAISE NOTICE 'orçamento % ausente na DEMO — seed pulado', v_orc; RETURN;
  END IF;
  -- O serviço de referência precisa existir no catálogo da DEMO; sem ele, não semeia.
  IF NOT EXISTS (SELECT 1 FROM public.projetos_servicos s WHERE s.id = v_serv AND s.company_id = v_company) THEN
    RAISE NOTICE 'serviço de referência ausente na DEMO — seed pulado'; RETURN;
  END IF;

  FOR r IN SELECT * FROM (VALUES
      ('ambiente', 'Câmara fria',   120::numeric),
      ('ambiente', 'Expedição',      85::numeric),
      ('ambiente', 'Doca de carga',  45::numeric)
    ) AS t(local_tipo, local_nome, qtd)
  LOOP
    -- Item compartilhado (erp_orcamentos_itens): idempotente pelo marcador em observacoes.
    SELECT id INTO v_item
    FROM public.erp_orcamentos_itens
    WHERE orcamento_id = v_orc AND company_id = v_company AND servico_id = v_serv
      AND observacoes = 'seed-eap315:' || r.local_nome AND excluido_em IS NULL;

    IF v_item IS NULL THEN
      INSERT INTO public.erp_orcamentos_itens
        (orcamento_id, company_id, tipo_item, servico_id, servico_codigo, servico_descricao,
         unidade, quantidade, preco_unitario, preco_custo, subtotal, observacoes)
      VALUES
        (v_orc, v_company, 'servico', v_serv, 'PSE-08.03.001',
         'Concreto fck 40Mpa usinado — piso industrial', 'm³',
         r.qtd, v_unit, v_unit, round(r.qtd * v_unit, 2), 'seed-eap315:' || r.local_nome)
      RETURNING id INTO v_item;
    END IF;

    -- Complemento EAP 1:1 (upsert por orcamento_item_id).
    INSERT INTO public.projetos_orcamento_item_eap
      (orcamento_item_id, company_id, eap_codigo, ref_padrao_codigo, local_tipo, local_nome,
       quantidade, custo_material_unit, custo_mao_obra_unit, origem)
    VALUES
      (v_item, v_company, '08.03', NULL, r.local_tipo, r.local_nome,
       r.qtd, v_mat, v_mo, 'empresa')
    ON CONFLICT (orcamento_item_id) DO UPDATE SET
      eap_codigo          = EXCLUDED.eap_codigo,
      local_tipo          = EXCLUDED.local_tipo,
      local_nome          = EXCLUDED.local_nome,
      quantidade          = EXCLUDED.quantidade,
      custo_material_unit = EXCLUDED.custo_material_unit,
      custo_mao_obra_unit = EXCLUDED.custo_mao_obra_unit,
      atualizado_em       = now();
  END LOOP;
END $$;
