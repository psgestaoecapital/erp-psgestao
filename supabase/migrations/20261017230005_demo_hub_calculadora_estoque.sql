-- HBF-0.3 · DEMO do Hub (chamado #3340): a Calculadora de Obra mostrava custo R$ 0,00 porque a Construtora Modelo - DEMO
-- não tinha produto no estoque nem de-para. Semente 100% fictícia e idempotente, SÓ na empresa DEMO (b0700000-...-0006).
-- Aditiva: INSERT ... WHERE NOT EXISTS / ON CONFLICT DO NOTHING; nenhum UPDATE/DELETE; nada para quem já opera.
-- Plano de volta: DELETE dos produtos DEMO-CALC-* (cascata remove os de-para) da empresa DEMO.
DO $$
DECLARE v_emp constant uuid := 'b0700000-0000-4000-a000-000000000006';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_emp) THEN RETURN; END IF;

  INSERT INTO public.erp_produtos (company_id, codigo, nome, unidade, preco_custo, preco_custo_medio, ativo)
  SELECT v_emp, p.codigo, p.nome, p.un, p.custo, p.custo, true
  FROM (VALUES
    ('DEMO-CALC-CHAPA',  'Chapa de gesso ST 12,5 mm (DEMO)',          'chapa',    42.90),
    ('DEMO-CALC-GUIA',   'Guia 48 mm barra 3 m (DEMO)',               'barra',    14.50),
    ('DEMO-CALC-MONT',   'Montante 48 mm barra 3 m (DEMO)',           'barra',    16.80),
    ('DEMO-CALC-BANDA',  'Banda acústica rolo 10 m (DEMO)',           'rolo',     38.00),
    ('DEMO-CALC-PPA25',  'Parafuso PPA25 cento (DEMO)',               'cento',    19.90),
    ('DEMO-CALC-MASSA',  'Massa para junta balde 5 kg (DEMO)',        'balde',    27.50),
    ('DEMO-CALC-FITA',   'Fita para junta rolo 90 m (DEMO)',          'rolo',     12.90),
    ('DEMO-CALC-LA',     'Lã mineral rolo (DEMO)',                    'rolo',     89.00),
    ('DEMO-CALC-F530',   'Perfil F530 barra 3 m (DEMO)',              'barra',    11.70),
    ('DEMO-CALC-TABICA', 'Tabica barra 3 m (DEMO)',                   'barra',    13.20),
    ('DEMO-CALC-PEND',   'Pendural (DEMO)',                           'unidade',   1.35),
    ('DEMO-CALC-TIRA',   'Tirante (DEMO)',                            'unidade',   2.10),
    ('DEMO-CALC-UNIAO',  'União para perfil F530 (DEMO)',             'unidade',   0.95),
    ('DEMO-CALC-PFM13',  'Parafuso PFM13 cento (DEMO)',               'cento',    14.40)
  ) AS p(codigo, nome, un, custo)
  WHERE NOT EXISTS (SELECT 1 FROM public.erp_produtos x WHERE x.company_id = v_emp AND x.codigo = p.codigo);

  INSERT INTO public.erp_calc_depara (company_id, sistema, chave, produto_id)
  SELECT v_emp, d.sistema, d.chave, x.id
  FROM (VALUES
    ('parede','chapa','DEMO-CALC-CHAPA'), ('parede','guia','DEMO-CALC-GUIA'), ('parede','montante','DEMO-CALC-MONT'),
    ('parede','banda','DEMO-CALC-BANDA'), ('parede','parafuso','DEMO-CALC-PPA25'), ('parede','massa','DEMO-CALC-MASSA'),
    ('parede','fita','DEMO-CALC-FITA'), ('parede','la','DEMO-CALC-LA'),
    ('forro_f530','chapa','DEMO-CALC-CHAPA'), ('forro_f530','perfil_f530','DEMO-CALC-F530'), ('forro_f530','tabica','DEMO-CALC-TABICA'),
    ('forro_f530','pendural','DEMO-CALC-PEND'), ('forro_f530','tirante','DEMO-CALC-TIRA'), ('forro_f530','uniao','DEMO-CALC-UNIAO'),
    ('forro_f530','ppa25','DEMO-CALC-PPA25'), ('forro_f530','pfm13','DEMO-CALC-PFM13'), ('forro_f530','massa','DEMO-CALC-MASSA'),
    ('forro_f530','fita','DEMO-CALC-FITA')
  ) AS d(sistema, chave, codigo)
  JOIN public.erp_produtos x ON x.company_id = v_emp AND x.codigo = d.codigo
  ON CONFLICT (company_id, sistema, chave) DO NOTHING;
END $$;
