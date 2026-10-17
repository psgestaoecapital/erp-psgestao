-- HBF-0.3 / chamado #3340: a Calculadora da DEMO mostrava custo R$ 0,00 porque a empresa
-- Construtora Modelo DEMO não tinha produto no estoque nem de-para. Semente 100% fictícia,
-- idempotente, só para a DEMO. Aditiva: não altera nem apaga nada existente (RD-97).
-- Volta: DELETE dos códigos DEMO-CALC-* e dos de-para da DEMO (nada de cliente real é tocado).
DO $$
DECLARE
  v_co constant uuid := 'b0700000-0000-4000-a000-000000000006';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_co) THEN
    RETURN;
  END IF;

  INSERT INTO public.erp_produtos (company_id, codigo, nome, unidade, preco_custo, preco_custo_medio, preco_venda, ativo, tipo, categoria, estoque_atual)
  SELECT v_co, s.codigo, s.nome, s.un, s.custo, s.custo, round(s.custo * 1.35, 2), true, 'produto', 'Drywall (DEMO)', s.est
  FROM (VALUES
    ('DEMO-CALC-CHAPA',  'Chapa de gesso ST 12,5 mm (DEMO)',      'UN',  42.90, 300),
    ('DEMO-CALC-GUIA',   'Guia 48 mm barra 3 m (DEMO)',           'UN',  14.50, 200),
    ('DEMO-CALC-MONT',   'Montante 48 mm barra 3 m (DEMO)',       'UN',  15.80, 400),
    ('DEMO-CALC-BANDA',  'Banda acústica rolo 10 m (DEMO)',       'UN',  38.00, 40),
    ('DEMO-CALC-PPA25',  'Parafuso PPA25 cento (DEMO)',           'CT',  18.90, 80),
    ('DEMO-CALC-PPA35',  'Parafuso PPA35 cento (DEMO)',           'CT',  24.90, 60),
    ('DEMO-CALC-PFM13',  'Parafuso PFM13 cento (DEMO)',           'CT',  21.50, 60),
    ('DEMO-CALC-MASSA',  'Massa para junta balde (DEMO)',         'UN',  54.00, 50),
    ('DEMO-CALC-FITA',   'Fita para junta rolo (DEMO)',           'UN',  12.40, 80),
    ('DEMO-CALC-LA',     'Lã mineral rolo (DEMO)',                'UN',  96.00, 30),
    ('DEMO-CALC-F530',   'Perfil F530 barra 3 m (DEMO)',          'UN',  13.20, 300),
    ('DEMO-CALC-TABICA', 'Tabica barra 3 m (DEMO)',               'UN',  11.90, 150),
    ('DEMO-CALC-PEND',   'Pendural (DEMO)',                       'UN',   2.10, 600),
    ('DEMO-CALC-TIRANTE','Tirante (DEMO)',                        'UN',   2.60, 600),
    ('DEMO-CALC-UNIAO',  'União de perfil (DEMO)',                'UN',   1.90, 600),
    ('DEMO-CALC-NERV',   'Nervura (DEMO)',                        'UN',   9.80, 200),
    ('DEMO-CALC-JUNCH',  'Junção H (DEMO)',                       'UN',   3.20, 300),
    ('DEMO-CALC-ARAME',  'Arame nº 18 kg (DEMO)',                 'KG',  16.00, 40),
    ('DEMO-CALC-GCOLA',  'Gesso cola saco (DEMO)',                'UN',  27.50, 60)
  ) AS s(codigo, nome, un, custo, est)
  WHERE NOT EXISTS (SELECT 1 FROM public.erp_produtos p WHERE p.company_id = v_co AND p.codigo = s.codigo);

  INSERT INTO public.erp_calc_depara (company_id, sistema, chave, produto_id)
  SELECT v_co, m.sistema, m.chave, p.id
  FROM (VALUES
    ('parede','chapa','DEMO-CALC-CHAPA'),('parede','guia','DEMO-CALC-GUIA'),('parede','montante','DEMO-CALC-MONT'),
    ('parede','banda','DEMO-CALC-BANDA'),('parede','parafuso','DEMO-CALC-PPA25'),('parede','massa','DEMO-CALC-MASSA'),
    ('parede','fita','DEMO-CALC-FITA'),('parede','la','DEMO-CALC-LA'),
    ('parede_separativa','chapa','DEMO-CALC-CHAPA'),('parede_separativa','guia','DEMO-CALC-GUIA'),('parede_separativa','montante','DEMO-CALC-MONT'),
    ('parede_separativa','banda','DEMO-CALC-BANDA'),('parede_separativa','parafuso','DEMO-CALC-PPA25'),('parede_separativa','massa','DEMO-CALC-MASSA'),
    ('parede_separativa','fita','DEMO-CALC-FITA'),('parede_separativa','la','DEMO-CALC-LA'),
    ('parede_corta_fogo','chapa','DEMO-CALC-CHAPA'),('parede_corta_fogo','guia','DEMO-CALC-GUIA'),('parede_corta_fogo','montante','DEMO-CALC-MONT'),
    ('parede_corta_fogo','banda','DEMO-CALC-BANDA'),('parede_corta_fogo','parafuso','DEMO-CALC-PPA25'),('parede_corta_fogo','parafuso_ppa35','DEMO-CALC-PPA35'),
    ('parede_corta_fogo','massa','DEMO-CALC-MASSA'),('parede_corta_fogo','fita','DEMO-CALC-FITA'),('parede_corta_fogo','la','DEMO-CALC-LA'),
    ('forro_f530','chapa','DEMO-CALC-CHAPA'),('forro_f530','perfil_f530','DEMO-CALC-F530'),('forro_f530','tabica','DEMO-CALC-TABICA'),
    ('forro_f530','pendural','DEMO-CALC-PEND'),('forro_f530','tirante','DEMO-CALC-TIRANTE'),('forro_f530','uniao','DEMO-CALC-UNIAO'),
    ('forro_f530','ppa25','DEMO-CALC-PPA25'),('forro_f530','pfm13','DEMO-CALC-PFM13'),('forro_f530','massa','DEMO-CALC-MASSA'),('forro_f530','fita','DEMO-CALC-FITA'),
    ('forro_aramado','chapa','DEMO-CALC-CHAPA'),('forro_aramado','nervura','DEMO-CALC-NERV'),('forro_aramado','juncao_h','DEMO-CALC-JUNCH'),
    ('forro_aramado','arame','DEMO-CALC-ARAME'),('forro_aramado','gesso_cola','DEMO-CALC-GCOLA'),('forro_aramado','massa','DEMO-CALC-MASSA'),('forro_aramado','fita','DEMO-CALC-FITA'),
    ('revestimento_colado','chapa','DEMO-CALC-CHAPA'),('revestimento_colado','gesso_cola','DEMO-CALC-GCOLA'),
    ('revestimento_colado','massa','DEMO-CALC-MASSA'),('revestimento_colado','fita','DEMO-CALC-FITA'),
    ('revestimento_estruturado','chapa','DEMO-CALC-CHAPA'),('revestimento_estruturado','guia','DEMO-CALC-GUIA'),('revestimento_estruturado','montante','DEMO-CALC-MONT'),
    ('revestimento_estruturado','banda','DEMO-CALC-BANDA'),('revestimento_estruturado','parafuso','DEMO-CALC-PPA25'),
    ('revestimento_estruturado','massa','DEMO-CALC-MASSA'),('revestimento_estruturado','fita','DEMO-CALC-FITA')
  ) AS m(sistema, chave, codigo)
  JOIN public.erp_produtos p ON p.company_id = v_co AND p.codigo = m.codigo
  ON CONFLICT (company_id, sistema, chave) DO NOTHING;
END $$;
