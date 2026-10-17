-- Hub DEMO (chamado #3340): a calculadora mostrava "Custo estimado R$ 0,00" na Construtora Modelo - DEMO porque a
-- empresa não tinha nenhum produto no estoque nem de-para da calculadora. Semente 100% fictícia, aditiva e idempotente:
-- só a empresa de demonstração fixa do Hub; produtos novos (código DEMO-CALC-*) só se não existirem; de-para só
-- onde a chave ainda não está vinculada. Não altera nem apaga nenhuma linha existente. Volta: remover as linhas
-- DEMO-CALC-* e seus de-para dessa empresa.
DO $$
DECLARE
  v_cid constant uuid := 'b0700000-0000-4000-a000-000000000006';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_cid) THEN
    RETURN;
  END IF;

  INSERT INTO public.erp_produtos (company_id, codigo, nome, unidade, preco_custo, preco_custo_medio, ativo)
  SELECT v_cid, s.codigo, s.nome, s.unidade, s.custo, s.custo, true
  FROM (VALUES
    ('DEMO-CALC-CHAPA',   'Chapa de gesso standard 1,20 × 1,80 (demo)', 'chapa',  38.90),
    ('DEMO-CALC-GUIA',    'Guia 48 mm barra 3 m (demo)',                'barra',  14.50),
    ('DEMO-CALC-MONT',    'Montante 48 mm barra 3 m (demo)',            'barra',  16.80),
    ('DEMO-CALC-BANDA',   'Banda acústica rolo 10 m (demo)',            'rolo',   22.00),
    ('DEMO-CALC-PPA25',   'Parafuso PPA25 cento (demo)',                'cento',  18.50),
    ('DEMO-CALC-PFM13',   'Parafuso PFM13 cento (demo)',                'cento',  24.00),
    ('DEMO-CALC-MASSA',   'Massa para junta balde 28 kg (demo)',        'balde',  64.00),
    ('DEMO-CALC-FITA',    'Fita para junta rolo 150 m (demo)',          'rolo',   17.90),
    ('DEMO-CALC-F530',    'Perfil F530 barra 3 m (demo)',               'barra',  12.40),
    ('DEMO-CALC-TABICA',  'Tabica barra 3 m (demo)',                    'barra',  13.20),
    ('DEMO-CALC-PEND',    'Pendural com regulador (demo)',              'unidade', 2.10),
    ('DEMO-CALC-TIRANTE', 'Tirante (demo)',                             'unidade', 1.80),
    ('DEMO-CALC-UNIAO',   'União para perfil F530 (demo)',              'unidade', 0.95)
  ) AS s(codigo, nome, unidade, custo)
  WHERE NOT EXISTS (SELECT 1 FROM public.erp_produtos p WHERE p.company_id = v_cid AND p.codigo = s.codigo);

  INSERT INTO public.erp_calc_depara (company_id, sistema, chave, produto_id)
  SELECT v_cid, m.sistema, m.chave, p.id
  FROM (VALUES
    ('parede', 'chapa', 'DEMO-CALC-CHAPA'), ('parede', 'guia', 'DEMO-CALC-GUIA'),
    ('parede', 'montante', 'DEMO-CALC-MONT'), ('parede', 'banda', 'DEMO-CALC-BANDA'),
    ('parede', 'parafuso', 'DEMO-CALC-PPA25'), ('parede', 'massa', 'DEMO-CALC-MASSA'),
    ('parede', 'fita', 'DEMO-CALC-FITA'),
    ('forro_f530', 'chapa', 'DEMO-CALC-CHAPA'), ('forro_f530', 'perfil_f530', 'DEMO-CALC-F530'),
    ('forro_f530', 'tabica', 'DEMO-CALC-TABICA'), ('forro_f530', 'pendural', 'DEMO-CALC-PEND'),
    ('forro_f530', 'tirante', 'DEMO-CALC-TIRANTE'), ('forro_f530', 'uniao', 'DEMO-CALC-UNIAO'),
    ('forro_f530', 'ppa25', 'DEMO-CALC-PPA25'), ('forro_f530', 'pfm13', 'DEMO-CALC-PFM13'),
    ('forro_f530', 'massa', 'DEMO-CALC-MASSA'), ('forro_f530', 'fita', 'DEMO-CALC-FITA')
  ) AS m(sistema, chave, codigo)
  JOIN public.erp_produtos p ON p.company_id = v_cid AND p.codigo = m.codigo
  WHERE NOT EXISTS (
    SELECT 1 FROM public.erp_calc_depara d
    WHERE d.company_id = v_cid AND d.sistema = m.sistema AND d.chave = m.chave
  );
END $$;
