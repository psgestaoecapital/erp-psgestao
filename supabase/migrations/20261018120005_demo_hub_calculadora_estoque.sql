-- HBF-0.3 / chamado #3340: a DEMO (Construtora Modelo) não tinha produto no estoque nem de-para da calculadora,
-- então o custo estimado saía R$ 0,00 ("Sem produto do estoque vinculado"). Semente ADITIVA e idempotente,
-- só na empresa DEMO, valores 100% fictícios. Plano de volta: remover os produtos DEMO-CALC-* e as linhas de
-- erp_calc_depara da DEMO (nenhum dado de cliente real é tocado).
DO $$
DECLARE
  v_co constant uuid := 'b0700000-0000-4000-a000-000000000006';
  r record;
  s text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_co) THEN
    RETURN;
  END IF;

  FOR r IN SELECT * FROM (VALUES
    ('chapa',       'Chapa de gesso standard 12,5 mm',  'chapa', 38.50),
    ('guia',        'Guia 48 mm (barra 3 m)',           'barra', 14.20),
    ('montante',    'Montante 48 mm (barra 3 m)',       'barra', 16.80),
    ('banda',       'Banda acústica (rolo 10 m)',       'rolo',  21.00),
    ('la',          'Lã mineral (rolo)',                'rolo',  96.00),
    ('parafuso',    'Parafuso PPA25 (cento)',           'cento', 14.90),
    ('parafuso_ppa35','Parafuso PPA35 (cento)',         'cento', 18.90),
    ('massa',       'Massa para junta (balde 5 kg)',    'balde', 32.00),
    ('fita',        'Fita para junta (rolo)',           'rolo',  12.50),
    ('perfil_f530', 'Perfil F530 (barra 3 m)',          'barra', 11.40),
    ('tabica',      'Tabica (barra 3 m)',               'barra', 12.90),
    ('pendural',    'Pendural',                         'un',     1.20),
    ('tirante',     'Tirante',                          'un',     2.10),
    ('uniao',       'União F530',                       'un',     0.95),
    ('ppa25',       'Parafuso PPA25 forro (cento)',     'cento', 14.90),
    ('pfm13',       'Parafuso PFM13 (cento)',           'cento', 16.40),
    ('nervura',     'Nervura forro aramado',            'un',    18.30),
    ('juncao_h',    'Junção H',                         'un',     0.80),
    ('arame',       'Arame nº 18 (kg)',                 'kg',    19.00),
    ('gesso_cola',  'Gesso cola (saco 40 kg)',          'saco',  27.00)
  ) AS t(chave, nome, unidade, custo)
  LOOP
    INSERT INTO erp_produtos (company_id, codigo, nome, unidade, preco_custo, preco_custo_medio, ativo)
    SELECT v_co, 'DEMO-CALC-' || upper(r.chave), r.nome, r.unidade, r.custo, r.custo, true
    WHERE NOT EXISTS (SELECT 1 FROM erp_produtos p WHERE p.company_id = v_co AND p.codigo = 'DEMO-CALC-' || upper(r.chave));
  END LOOP;

  FOR s IN SELECT unnest(ARRAY['parede','parede_separativa','parede_corta_fogo','revestimento_estruturado','revestimento_colado','forro_aramado','forro_f530']) LOOP
    INSERT INTO erp_calc_depara (company_id, sistema, chave, produto_id)
    SELECT v_co, s, k.chave, p.id
      FROM unnest(CASE s
        WHEN 'forro_f530' THEN ARRAY['chapa','perfil_f530','tabica','pendural','tirante','uniao','ppa25','pfm13','massa','fita']
        WHEN 'forro_aramado' THEN ARRAY['chapa','nervura','juncao_h','arame','gesso_cola','massa','fita']
        WHEN 'revestimento_colado' THEN ARRAY['chapa','gesso_cola','massa','fita']
        ELSE ARRAY['chapa','guia','montante','banda','la','parafuso','parafuso_ppa35','massa','fita'] END) AS k(chave)
      JOIN erp_produtos p ON p.company_id = v_co AND p.codigo = 'DEMO-CALC-' || upper(k.chave)
    ON CONFLICT (company_id, sistema, chave) DO NOTHING;
  END LOOP;
END $$;
