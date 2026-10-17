-- #3340 (Code-Auditor): a Calculadora de Obra mostrava custo R$ 0,00 na Construtora Modelo - DEMO porque a empresa
-- não tinha produto no estoque nem de-para. Semente 100% fictícia e idempotente, SÓ na DEMO (b0700000-...-000006).
-- Aditiva: não altera função, tela, regra nem dado de outra empresa. Plano de volta: remover as linhas CALC-DEMO-* e os
-- de-para da DEMO (nada depende delas fora da calculadora).
DO $$
DECLARE
  v_demo constant uuid := 'b0700000-0000-4000-a000-000000000006';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_demo) THEN
    RETURN;
  END IF;

  INSERT INTO public.erp_produtos (company_id, codigo, nome, unidade, preco_custo, preco_custo_medio, ativo)
  SELECT v_demo, p.codigo, p.nome, p.unidade, p.custo, p.custo, true
  FROM (VALUES
    ('CALC-DEMO-CHAPA',   'Chapa de gesso standard 1,20 × 1,80 (DEMO)', 'chapa', 32.90),
    ('CALC-DEMO-GUIA',    'Guia 48 mm (DEMO)',                          'barra', 18.50),
    ('CALC-DEMO-MONT',    'Montante 48 mm (DEMO)',                      'barra', 21.90),
    ('CALC-DEMO-BANDA',   'Banda acústica 10 m (DEMO)',                 'rolo',  38.00),
    ('CALC-DEMO-PPA25',   'Parafuso PPA25 cento (DEMO)',                'cento', 14.00),
    ('CALC-DEMO-PPA35',   'Parafuso PPA35 cento (DEMO)',                'cento', 16.00),
    ('CALC-DEMO-PFM13',   'Parafuso PFM13 cento (DEMO)',                'cento', 11.00),
    ('CALC-DEMO-MASSA',   'Massa para junta balde (DEMO)',              'balde', 62.00),
    ('CALC-DEMO-FITA',    'Fita para junta rolo (DEMO)',                'rolo',  19.00),
    ('CALC-DEMO-LA',      'Lã mineral rolo (DEMO)',                     'rolo',  48.00),
    ('CALC-DEMO-F530',    'Perfil F530 barra 3 m (DEMO)',               'barra', 15.80),
    ('CALC-DEMO-TABICA',  'Tabica barra 3 m (DEMO)',                    'barra', 14.50),
    ('CALC-DEMO-PENDURAL','Pendural (DEMO)',                            'un',     1.20),
    ('CALC-DEMO-TIRANTE', 'Tirante (DEMO)',                             'un',     2.10),
    ('CALC-DEMO-UNIAO',   'União (DEMO)',                               'un',     1.50),
    ('CALC-DEMO-NERVURA', 'Nervura (DEMO)',                             'un',     9.50),
    ('CALC-DEMO-JUNCAOH', 'Junção H (DEMO)',                            'un',     3.20),
    ('CALC-DEMO-ARAME',   'Arame nº 18 (DEMO)',                         'kg',    17.00),
    ('CALC-DEMO-GCOLA',   'Gesso cola saco (DEMO)',                     'saco',  28.00)
  ) AS p(codigo, nome, unidade, custo)
  ON CONFLICT (company_id, codigo) DO NOTHING;

  INSERT INTO public.erp_calc_depara (company_id, sistema, chave, produto_id)
  SELECT v_demo, d.sistema, d.chave, pr.id
  FROM (VALUES
    ('chapa','CALC-DEMO-CHAPA'), ('guia','CALC-DEMO-GUIA'), ('montante','CALC-DEMO-MONT'), ('banda','CALC-DEMO-BANDA'),
    ('parafuso','CALC-DEMO-PPA25'), ('parafuso_ppa35','CALC-DEMO-PPA35'), ('ppa25','CALC-DEMO-PPA25'), ('pfm13','CALC-DEMO-PFM13'),
    ('massa','CALC-DEMO-MASSA'), ('fita','CALC-DEMO-FITA'), ('la','CALC-DEMO-LA'), ('perfil_f530','CALC-DEMO-F530'),
    ('tabica','CALC-DEMO-TABICA'), ('pendural','CALC-DEMO-PENDURAL'), ('tirante','CALC-DEMO-TIRANTE'), ('uniao','CALC-DEMO-UNIAO'),
    ('nervura','CALC-DEMO-NERVURA'), ('juncao_h','CALC-DEMO-JUNCAOH'), ('arame','CALC-DEMO-ARAME'), ('gesso_cola','CALC-DEMO-GCOLA')
  ) AS m(chave, codigo)
  JOIN (VALUES
    ('parede','chapa'),('parede','guia'),('parede','montante'),('parede','banda'),('parede','parafuso'),('parede','massa'),('parede','fita'),('parede','la'),
    ('parede_separativa','chapa'),('parede_separativa','guia'),('parede_separativa','montante'),('parede_separativa','banda'),('parede_separativa','parafuso'),('parede_separativa','massa'),('parede_separativa','fita'),('parede_separativa','la'),
    ('parede_corta_fogo','chapa'),('parede_corta_fogo','guia'),('parede_corta_fogo','montante'),('parede_corta_fogo','banda'),('parede_corta_fogo','parafuso'),('parede_corta_fogo','massa'),('parede_corta_fogo','fita'),('parede_corta_fogo','la'),
    ('revestimento_estruturado','chapa'),('revestimento_estruturado','guia'),('revestimento_estruturado','montante'),('revestimento_estruturado','banda'),('revestimento_estruturado','parafuso'),('revestimento_estruturado','parafuso_ppa35'),('revestimento_estruturado','massa'),('revestimento_estruturado','fita'),
    ('revestimento_colado','chapa'),('revestimento_colado','gesso_cola'),('revestimento_colado','massa'),('revestimento_colado','fita'),
    ('forro_aramado','chapa'),('forro_aramado','nervura'),('forro_aramado','juncao_h'),('forro_aramado','arame'),('forro_aramado','gesso_cola'),('forro_aramado','massa'),('forro_aramado','fita'),
    ('forro_f530','chapa'),('forro_f530','perfil_f530'),('forro_f530','tabica'),('forro_f530','pendural'),('forro_f530','tirante'),('forro_f530','uniao'),('forro_f530','ppa25'),('forro_f530','pfm13'),('forro_f530','massa'),('forro_f530','fita')
  ) AS d(sistema, chave) ON d.chave = m.chave
  JOIN public.erp_produtos pr ON pr.company_id = v_demo AND pr.codigo = m.codigo
  ON CONFLICT (company_id, sistema, chave) DO NOTHING;
END $$;
