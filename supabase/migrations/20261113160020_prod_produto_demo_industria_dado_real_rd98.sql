-- RD-98 p1 (auditor PDCA): /dashboard/produtividade/produtos mostrava só 3 produtos de
-- teste do e2e — "Produto A / Renomeado / Produto C mvfehng7" (códigos Tmvfehng7A/B/C) —,
-- dando à tela aparência de dado-fantasma, com LINHA, CONSERVAÇÃO e PESO vazios. A tela
-- filtra ativo=true e só essas 3 linhas estavam ativas na planta DEMO.
--
-- Esta migration, SOMENTE na empresa DEMO "Indústria (SST)" (id b0700000-…-005, is_demo=true):
--   1) arquiva (ativo=false) os 3 produtos-fantasma do e2e, por código exato;
--   2) semeia o fluxo real de desossa bovina, para a tela mostrar dado com significado
--      (código legível, linha, conservação e peso preenchidos).
--
-- Re-submissão do seed da PR #4595: a migration original (20261113140120) foi PERDIDA na
-- corrida de renumeração do lote de merge (versão ausente do ledger e de origin/main) e,
-- além disso, usava valores de `papel` FORA do CHECK da tabela
-- (prod_produto_papel_check = {acabado, intermediario, origem, subproduto}), o que teria
-- quebrado o deploy. Aqui o papel é mapeado para o domínio válido, mantendo o fluxo legível:
-- origem (boi em pé) → intermediario (carcaça e quartos) → acabado (cortes) → subproduto (sebo/ossos).
--
-- ADITIVA e IDEMPOTENTE (semeia por código só se não existir; arquiva só o que está ativo).
-- NÃO toca dado de cliente (a empresa é DEMO). Sem DDL, sem RLS nova (prod_produto já tem RLS
-- por company_id). Não varre tabela grande nem chama função por linha em volume.
-- RD-38 (prova no PR): antes = 3 ativos fantasma / 0 reais; depois = 0 fantasma ativo / 13 reais.

DO $$
DECLARE
  v_company uuid := 'b0700000-0000-4000-a000-000000000005';
  v_plant   uuid := '49a0d5ae-c5f8-4969-a40e-46f800f1a2a1';
BEGIN
  -- guarda: só roda em empresa DEMO existente (nunca em dado de cliente)
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_company AND is_demo IS TRUE) THEN
    RAISE NOTICE 'Empresa DEMO Indústria (SST) ausente ou não-DEMO — seed de produtos ignorado';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM industrial_plants WHERE id = v_plant AND company_id = v_company) THEN
    RAISE NOTICE 'Planta DEMO ausente — seed de produtos ignorado';
    RETURN;
  END IF;

  -- 1) arquiva os 3 produtos-fantasma do e2e (por código exato), se ainda ativos
  UPDATE prod_produto
     SET ativo = false, updated_at = now()
   WHERE company_id = v_company AND plant_id = v_plant
     AND codigo IN ('Tmvfehng7A', 'Tmvfehng7B', 'Tmvfehng7C')
     AND ativo = true;

  -- 2) semeia o fluxo real de desossa bovina (idempotente por código; papel no domínio do CHECK)
  INSERT INTO prod_produto (company_id, plant_id, codigo, nome, papel, linha, conservacao, peso_aprox_kg, ativo)
  SELECT v_company, v_plant, s.codigo, s.nome, s.papel, s.linha, s.conservacao, s.peso, true
    FROM (VALUES
      ('BOV-001', 'Boi em pé',          'origem',        'Abate',        NULL::text,    NULL::numeric),
      ('BOV-010', 'Carcaça bovina',     'intermediario', 'Desossa',      'RESFRIADO',   230.0),
      ('BOV-011', 'Quarto dianteiro',   'intermediario', 'Desossa',      'RESFRIADO',   55.0),
      ('BOV-012', 'Quarto traseiro',    'intermediario', 'Desossa',      'RESFRIADO',   60.0),
      ('BOV-100', 'Dianteiro com osso', 'acabado',       'Cortes',       'RESFRIADO',   50.0),
      ('BOV-101', 'Costela janela',     'acabado',       'Cortes',       'RESFRIADO',   12.0),
      ('BOV-200', 'Acém',               'acabado',       'Cortes',       'RESFRIADO',   8.0),
      ('BOV-201', 'Paleta',             'acabado',       'Cortes',       'RESFRIADO',   6.5),
      ('BOV-202', 'Coxão mole',         'acabado',       'Cortes',       'RESFRIADO',   9.0),
      ('BOV-203', 'Patinho',            'acabado',       'Cortes',       'RESFRIADO',   5.0),
      ('BOV-204', 'Picanha',            'acabado',       'Cortes',       'CONGELADO',   1.3),
      ('BOV-300', 'Fígado bovino',      'acabado',       'Miúdos',       'CONGELADO',   5.0),
      ('BOV-400', 'Sebo e ossos',       'subproduto',    'Subprodutos',  NULL,          20.0)
    ) AS s(codigo, nome, papel, linha, conservacao, peso)
   WHERE NOT EXISTS (
     SELECT 1 FROM prod_produto p
      WHERE p.company_id = v_company AND p.plant_id = v_plant AND p.codigo = s.codigo
   );
END $$;
