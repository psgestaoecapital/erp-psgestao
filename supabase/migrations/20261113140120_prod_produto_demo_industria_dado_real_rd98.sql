-- RD-98 p1 (auditor PDCA): /dashboard/produtividade/produtos mostrava só 3 produtos de
-- teste do e2e — "Produto A / Renomeado / Produto C mvfehng7" (códigos Tmvfehng7A/B/C) —,
-- dando à tela aparência de dado-fantasma. A tela filtra ativo=true e só essas 3 linhas
-- estavam ativas na planta DEMO.
--
-- Esta migration, SOMENTE na empresa DEMO "Indústria (SST)" (id b0700000-…-005, is_demo=true):
--   1) arquiva (ativo=false) os 3 produtos-fantasma do e2e, por código exato;
--   2) semeia o fluxo real de desossa bovina, para a tela mostrar dado com significado.
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

  -- 2) semeia o fluxo real de desossa bovina (idempotente por código)
  INSERT INTO prod_produto (company_id, plant_id, codigo, nome, papel, linha, conservacao, peso_aprox_kg, ativo)
  SELECT v_company, v_plant, s.codigo, s.nome, s.papel, s.linha, s.conservacao, s.peso, true
    FROM (VALUES
      ('BOV-001', 'Boi em pé',          'entrada_animal',         'padrao', NULL,        NULL::numeric),
      ('BOV-010', 'Carcaça bovina',     'carcaca',                'padrao', 'RESFRIADO', 230.0),
      ('BOV-011', 'Quarto dianteiro',   'carcaca_quarto',         'padrao', 'RESFRIADO', 55.0),
      ('BOV-012', 'Quarto traseiro',    'carcaca_quarto',         'padrao', 'RESFRIADO', 60.0),
      ('BOV-100', 'Dianteiro com osso', 'produto_final_com_osso', 'padrao', 'RESFRIADO', 50.0),
      ('BOV-101', 'Costela janela',     'produto_final_com_osso', 'padrao', 'RESFRIADO', 12.0),
      ('BOV-200', 'Acém',               'produto_final_sem_osso', 'padrao', 'RESFRIADO', 8.0),
      ('BOV-201', 'Paleta',             'produto_final_sem_osso', 'padrao', 'RESFRIADO', 6.5),
      ('BOV-202', 'Coxão mole',         'produto_final_sem_osso', 'padrao', 'RESFRIADO', 9.0),
      ('BOV-203', 'Patinho',            'produto_final_sem_osso', 'padrao', 'RESFRIADO', 5.0),
      ('BOV-204', 'Picanha',            'produto_final_sem_osso', 'padrao', 'CONGELADO', 1.3),
      ('BOV-300', 'Fígado bovino',      'miudo',                  'padrao', 'CONGELADO', 5.0),
      ('BOV-400', 'Sebo e ossos',       'subproduto',             'padrao', NULL,        20.0)
    ) AS s(codigo, nome, papel, linha, conservacao, peso)
   WHERE NOT EXISTS (
     SELECT 1 FROM prod_produto p
      WHERE p.company_id = v_company AND p.plant_id = v_plant AND p.codigo = s.codigo
   );
END $$;
