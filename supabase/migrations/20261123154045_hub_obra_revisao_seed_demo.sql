-- Hub · Gestão de Obras · Revisões de escopo (blueprint vivo tela 314 / §16 H2) — SEED da DEMO.
-- Gap aud8 (21/11, nota 92): a tabela projetos_obra_revisao estava VAZIA na DEMO, então a aba
-- "Revisões de escopo" só abria no estado vazio — impossível provar o critério b (os dados da
-- revisão carregam na lista) e o critério c (ao APROVAR, o novo valor passa a valer no contrato),
-- e sem rascunho real não dava para exercitar Editar/Excluir (RD-98 g, PRs #5693/#5694).
--
-- Esta migration é ADITIVA e só semeia dados de DEMONSTRAÇÃO, exclusivamente na Construtora
-- Modelo - DEMO (empresa b0700000-0000-4000-a000-000000000006), na obra DEMO-OB-001
-- ("Forro e divisórias – Vista Verde", 11a80fcc...). Não cria tabela, não mexe em RLS/grants,
-- não toca núcleo nem dado de cliente real. IDs fixos + ON CONFLICT (id) DO NOTHING => idempotente
-- (re-rodar não duplica). Guarda por existência da obra DEMO: se o seed-base não estiver presente
-- (ex.: banco de testes sem a obra), o bloco apenas registra um NOTICE e não falha o deploy.
-- Os valores de cada revisão batem com os itens do orçamento da obra (forro 165 m²×R$89,06 +
-- parede 190 m²×R$131,69 = R$39.716,00 = valor previsto atual), de modo que a revisão APROVADA
-- conta a história "o contrato de R$39.716,00 veio de uma revisão aprovada a partir de R$37.934,80".

DO $seed$
DECLARE
  v_company uuid := 'b0700000-0000-4000-a000-000000000006';
  v_obra    uuid := '11a80fcc-0c9c-492b-b993-08df3a74fd77';
  v_forro   uuid;  -- item "Forro de gesso acartonado" (165 m² × R$89,06)
  v_parede  uuid;  -- item "Parede drywall simples"   (190 m² × R$131,69)
  -- IDs fixos das revisões (idempotência)
  r_aprov uuid := 'a6b10006-0000-4000-a006-000000000001';
  r_solic uuid := 'a6b10006-0000-4000-a006-000000000002';
  r_rasc  uuid := 'a6b10006-0000-4000-a006-000000000003';
  r_recus uuid := 'a6b10006-0000-4000-a006-000000000004';
BEGIN
  -- Guarda: só semeia se a obra DEMO existir nessa empresa (evita violar FK onde o seed-base não está).
  IF NOT EXISTS (
    SELECT 1 FROM public.projetos_obras
     WHERE id = v_obra AND company_id = v_company AND deleted_at IS NULL
  ) THEN
    RAISE NOTICE 'Obra DEMO % ausente na empresa %; seed de revisões ignorado.', v_obra, v_company;
    RETURN;
  END IF;

  SELECT id INTO v_forro  FROM public.projetos_obra_item
    WHERE obra_id = v_obra AND descricao = 'Forro de gesso acartonado' LIMIT 1;
  SELECT id INTO v_parede FROM public.projetos_obra_item
    WHERE obra_id = v_obra AND descricao = 'Parede drywall simples'   LIMIT 1;

  -- 1) APROVADA (pedido do cliente) — prova o critério c: o valor novo passou a valer no contrato.
  INSERT INTO public.projetos_obra_revisao
    (id, company_id, obra_id, sequencial, origem, motivo, status,
     valor_anterior, valor_novo, solicitado_em, aprovado_em, observacoes, criado_em, atualizado_em)
  VALUES
    (r_aprov, v_company, v_obra, 1, 'pedido_cliente',
     'Acréscimo de 20 m² de forro de gesso a pedido do cliente', 'aprovada',
     37934.80, 39716.00,
     now() - interval '12 days', now() - interval '10 days',
     'Aprovada pela gestão; novo valor em vigor no contrato da obra.',
     now() - interval '12 days', now() - interval '10 days')
  ON CONFLICT (id) DO NOTHING;

  -- 2) SOLICITADA (interna) — aguardando aprovação; o contrato ainda não mudou.
  INSERT INTO public.projetos_obra_revisao
    (id, company_id, obra_id, sequencial, origem, motivo, status,
     valor_anterior, valor_novo, solicitado_em, aprovado_em, observacoes, criado_em, atualizado_em)
  VALUES
    (r_solic, v_company, v_obra, 2, 'interno',
     'Reforço de 10 m² de parede drywall identificado na execução', 'solicitada',
     39716.00, 41032.90,
     now() - interval '4 days', NULL,
     'Enviada para aprovação da gestão.',
     now() - interval '4 days', now() - interval '4 days')
  ON CONFLICT (id) DO NOTHING;

  -- 3) RASCUNHO (interna) — base real para Editar/Excluir (RD-98 g, PRs #5693/#5694).
  INSERT INTO public.projetos_obra_revisao
    (id, company_id, obra_id, sequencial, origem, motivo, status,
     valor_anterior, valor_novo, solicitado_em, aprovado_em, observacoes, criado_em, atualizado_em)
  VALUES
    (r_rasc, v_company, v_obra, 3, 'interno',
     'Ajuste de 5 m² de parede drywall (em elaboração)', 'rascunho',
     39716.00, 40374.45,
     now() - interval '1 day', NULL,
     'Rascunho em elaboração — pode ser editado ou excluído antes de solicitar.',
     now() - interval '1 day', now() - interval '1 day')
  ON CONFLICT (id) DO NOTHING;

  -- 4) RECUSADA (pedido do cliente) — supressão não aceita; o contrato permaneceu em R$39.716,00.
  INSERT INTO public.projetos_obra_revisao
    (id, company_id, obra_id, sequencial, origem, motivo, status,
     valor_anterior, valor_novo, solicitado_em, aprovado_em, observacoes, criado_em, atualizado_em)
  VALUES
    (r_recus, v_company, v_obra, 4, 'pedido_cliente',
     'Supressão de 10 m² de forro solicitada pelo cliente', 'recusada',
     39716.00, 38825.40,
     now() - interval '8 days', NULL,
     'Recusada: a supressão inviabiliza o cronograma acordado.',
     now() - interval '8 days', now() - interval '7 days')
  ON CONFLICT (id) DO NOTHING;

  -- Itens de cada revisão (só quando o item-base do orçamento existir).
  IF v_forro IS NOT NULL THEN
    INSERT INTO public.projetos_obra_revisao_item
      (id, company_id, revisao_id, obra_item_id, descricao, unidade,
       quantidade_anterior, quantidade_nova, preco_unitario_anterior, preco_unitario_novo,
       quantidade_medida_na_revisao, motivo, criado_em)
    VALUES
      ('a6b10006-0000-4000-a006-0000000000a1', v_company, r_aprov, v_forro,
       'Forro de gesso acartonado', 'm2', 165.0000, 185.0000, 89.0600, 89.0600,
       NULL, 'Acréscimo de 20 m² a pedido do cliente', now() - interval '12 days'),
      ('a6b10006-0000-4000-a006-0000000000a4', v_company, r_recus, v_forro,
       'Forro de gesso acartonado', 'm2', 165.0000, 155.0000, 89.0600, 89.0600,
       NULL, 'Supressão de 10 m² (recusada)', now() - interval '8 days')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF v_parede IS NOT NULL THEN
    INSERT INTO public.projetos_obra_revisao_item
      (id, company_id, revisao_id, obra_item_id, descricao, unidade,
       quantidade_anterior, quantidade_nova, preco_unitario_anterior, preco_unitario_novo,
       quantidade_medida_na_revisao, motivo, criado_em)
    VALUES
      ('a6b10006-0000-4000-a006-0000000000a2', v_company, r_solic, v_parede,
       'Parede drywall simples', 'm2', 190.0000, 200.0000, 131.6900, 131.6900,
       NULL, 'Reforço de 10 m² identificado na execução', now() - interval '4 days'),
      ('a6b10006-0000-4000-a006-0000000000a3', v_company, r_rasc, v_parede,
       'Parede drywall simples', 'm2', 190.0000, 195.0000, 131.6900, 131.6900,
       NULL, 'Ajuste de 5 m² (rascunho)', now() - interval '1 day')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RAISE NOTICE 'Seed de revisões de escopo da DEMO aplicado na obra %.', v_obra;
END $seed$;
