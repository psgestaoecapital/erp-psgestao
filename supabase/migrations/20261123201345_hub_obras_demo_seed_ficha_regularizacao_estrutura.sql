-- Hub · Gestão de Obras — seed DEMO para destravar o PDCA (RD-98 p1 "sem tela morta")
-- das telas-irmãs da obra: ficha (identidade do imóvel), regularização (licenças) e estrutura.
-- SÓ na Construtora Modelo - DEMO (b0700000-0000-4000-a000-000000000006) — RD-69/LGPD.
-- Aditiva e idempotente (NOT EXISTS / UPDATE só quando null). Nenhuma tabela/função/RLS nova.
-- Code: desenvolvedor_4_g

DO $$
DECLARE
  v_company uuid := 'b0700000-0000-4000-a000-000000000006';
  v_obra_mercado uuid := '304678f8-7b38-424a-af9c-19e28ed94364'; -- "Mercado Central Demo" (comercial)
  v_obra_sala    uuid := '51db2096-e659-4bf4-84fb-3dab98746ba6'; -- "Sala comercial – Horizonte"
  v_bloco uuid;
  v_pav_terreo uuid;
  v_pav_mezanino uuid;
BEGIN
  -- Guarda: só segue se as obras forem mesmo da empresa DEMO (RD-69). Se não existirem, não faz nada.
  IF NOT EXISTS (SELECT 1 FROM projetos_obras WHERE id = v_obra_mercado AND company_id = v_company) THEN
    RAISE NOTICE 'obra DEMO Mercado Central ausente — seed ignorado';
    RETURN;
  END IF;

  -- ============================================================
  -- 1) FICHA · Identidade do imóvel (UPDATE idempotente, só quando null — não sobrescreve)
  -- ============================================================
  UPDATE projetos_obras
     SET matricula = '12.345',
         inscricao_imobiliaria = '01.02.03.0456.001',
         tipo_edificacao = 'comercial',
         area_construida_m2 = 1250.00,
         area_terreno_m2 = 800.00
   WHERE id = v_obra_mercado AND company_id = v_company
     AND matricula IS NULL AND inscricao_imobiliaria IS NULL AND tipo_edificacao IS NULL;

  UPDATE projetos_obras
     SET matricula = '98.765',
         inscricao_imobiliaria = '09.08.07.0654.002',
         tipo_edificacao = 'comercial',
         area_construida_m2 = 85.50,
         area_terreno_m2 = 120.00
   WHERE id = v_obra_sala AND company_id = v_company
     AND matricula IS NULL AND inscricao_imobiliaria IS NULL AND tipo_edificacao IS NULL;

  -- ============================================================
  -- 2) REGULARIZAÇÃO · Licenças (INSERT idempotente por (obra_id,tipo,numero))
  --    cobre os 4 estados do resumo: vigente · vence_30 · sem_validade · vencido
  -- ============================================================
  INSERT INTO projetos_obra_licenca (company_id, obra_id, tipo, numero, orgao, responsavel, descricao, emissao, validade)
  SELECT v_company, v_obra_mercado, d.tipo, d.numero, d.orgao, d.responsavel, d.descricao, d.emissao, d.validade
  FROM (VALUES
      -- VIGENTE (validade distante)
      ('alvara'::text,          'ALV-2026-0304'::text,   'Prefeitura Municipal'::text, 'Eng. Marina Alvares'::text, 'Alvará de construção da edificação comercial'::text, DATE '2026-01-10', (CURRENT_DATE + 300)),
      -- VENCE_30 (validade dentro de 30 dias)
      ('licenca_operacao',      'LO-2026-118',            'Órgão ambiental estadual',  'Eng. Marina Alvares',       'Licença de operação do empreendimento',               DATE '2026-02-15', (CURRENT_DATE + 15)),
      -- SEM_VALIDADE (ART sem data de validade)
      ('art',                   'ART-2026-55123',         'Conselho de classe',        'Eng. Marina Alvares',       'ART de execução da obra',                             DATE '2026-02-01', NULL::date),
      -- VENCIDO (validade no passado)
      ('licenca_previa',        'LP-2025-0099',           'Órgão ambiental estadual',  'Eng. Marina Alvares',       'Licença prévia — renovação pendente',                 DATE '2025-06-01', (CURRENT_DATE - 60))
  ) AS d(tipo, numero, orgao, responsavel, descricao, emissao, validade)
  WHERE NOT EXISTS (
    SELECT 1 FROM projetos_obra_licenca l
     WHERE l.obra_id = v_obra_mercado AND l.tipo = d.tipo AND l.numero = d.numero
  );

  -- ============================================================
  -- 3) ESTRUTURA · árvore bloco → pavimento → unidade (idempotente por nome dentro do pai)
  -- ============================================================
  -- Bloco
  SELECT id INTO v_bloco FROM projetos_obra_estrutura
   WHERE obra_id = v_obra_mercado AND parent_id IS NULL AND nivel = 'bloco' AND nome = 'Bloco Principal' AND excluido_em IS NULL
   LIMIT 1;
  IF v_bloco IS NULL THEN
    INSERT INTO projetos_obra_estrutura (company_id, obra_id, parent_id, nivel, nome, ordem)
    VALUES (v_company, v_obra_mercado, NULL, 'bloco', 'Bloco Principal', 1)
    RETURNING id INTO v_bloco;
  END IF;

  -- Pavimento: Térreo
  SELECT id INTO v_pav_terreo FROM projetos_obra_estrutura
   WHERE obra_id = v_obra_mercado AND parent_id = v_bloco AND nivel = 'pavimento' AND nome = 'Térreo' AND excluido_em IS NULL
   LIMIT 1;
  IF v_pav_terreo IS NULL THEN
    INSERT INTO projetos_obra_estrutura (company_id, obra_id, parent_id, nivel, nome, ordem)
    VALUES (v_company, v_obra_mercado, v_bloco, 'pavimento', 'Térreo', 1)
    RETURNING id INTO v_pav_terreo;
  END IF;

  -- Pavimento: Mezanino
  SELECT id INTO v_pav_mezanino FROM projetos_obra_estrutura
   WHERE obra_id = v_obra_mercado AND parent_id = v_bloco AND nivel = 'pavimento' AND nome = 'Mezanino' AND excluido_em IS NULL
   LIMIT 1;
  IF v_pav_mezanino IS NULL THEN
    INSERT INTO projetos_obra_estrutura (company_id, obra_id, parent_id, nivel, nome, ordem)
    VALUES (v_company, v_obra_mercado, v_bloco, 'pavimento', 'Mezanino', 2)
    RETURNING id INTO v_pav_mezanino;
  END IF;

  -- Unidades do Térreo
  INSERT INTO projetos_obra_estrutura (company_id, obra_id, parent_id, nivel, nome, ordem)
  SELECT v_company, v_obra_mercado, v_pav_terreo, 'unidade', u.nome, u.ordem
  FROM (VALUES ('Loja 01', 1), ('Loja 02', 2)) AS u(nome, ordem)
  WHERE NOT EXISTS (
    SELECT 1 FROM projetos_obra_estrutura e
     WHERE e.obra_id = v_obra_mercado AND e.parent_id = v_pav_terreo AND e.nivel = 'unidade' AND e.nome = u.nome AND e.excluido_em IS NULL
  );

  -- Unidade do Mezanino
  INSERT INTO projetos_obra_estrutura (company_id, obra_id, parent_id, nivel, nome, ordem)
  SELECT v_company, v_obra_mercado, v_pav_mezanino, 'unidade', 'Administração', 1
  WHERE NOT EXISTS (
    SELECT 1 FROM projetos_obra_estrutura e
     WHERE e.obra_id = v_obra_mercado AND e.parent_id = v_pav_mezanino AND e.nivel = 'unidade' AND e.nome = 'Administração' AND e.excluido_em IS NULL
  );
END $$;
