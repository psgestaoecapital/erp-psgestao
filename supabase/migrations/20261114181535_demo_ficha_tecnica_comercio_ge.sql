-- Seed DEMO: 1 ficha técnica composta para a Comércio (GE) - DEMO
-- Tela /dashboard/commerce/fichas (PDCA GE, aud8 88/95): a DEMO não tinha
-- nenhuma ficha, então a jornada central (materiais + mão de obra + custos
-- indiretos + impostos + markup -> preço de venda por m²) não era demonstrável.
--
-- ADITIVO, IDEMPOTENTE e SÓ DEMO: usa UUIDs fixos + WHERE NOT EXISTS; guarda
-- is_demo para NUNCA tocar dado de empresa real. fn_demo_reset não mexe em
-- fichas_tecnicas/ficha_itens, então o seed é durável (sobrevive ao reset).
--
-- Composição (mesma fórmula de calcular() na tela):
--   materiais = Σ(quantidade × preço) = R$ 50,77
--   custoBase = materiais + mão de obra (22,00) = R$ 72,77
--   indiretos (8%)  = R$ 5,8216
--   impostos (12%) sobre (custoBase+indiretos) = R$ 9,4310
--   custoTotal = R$ 88,0226 · markup (35%) = R$ 30,81 · preço venda ≈ R$ 118,83/m²
--
-- Code: code-desenvolvedor-3

-- 1) Cabeçalho da ficha
INSERT INTO public.fichas_tecnicas
  (id, company_id, codigo, nome, categoria, descricao, unidade,
   mao_obra_direta, custos_indiretos_pct, impostos_pct, markup_pct, ativo)
SELECT
  'f1c40004-0000-4000-a000-000000000001'::uuid,
  'b0700000-0000-4000-a000-000000000004'::uuid,
  'DEMO-FT-DRYWALL',
  'Parede Drywall ST 73mm (dupla face)',
  'parede',
  'Ficha-exemplo: composição de materiais + mão de obra + custos indiretos + impostos + markup até o preço de venda por m².',
  'm²',
  22.00, 8, 12, 35, true
WHERE EXISTS (
  SELECT 1 FROM public.companies c
  WHERE c.id = 'b0700000-0000-4000-a000-000000000004'::uuid AND c.is_demo
)
AND NOT EXISTS (
  SELECT 1 FROM public.fichas_tecnicas f
  WHERE f.id = 'f1c40004-0000-4000-a000-000000000001'::uuid
);

-- 2) Itens (materiais) da ficha
INSERT INTO public.ficha_itens
  (id, ficha_id, ordem, codigo, nome, unidade, quantidade, preco_unitario, fornecedor)
SELECT v.id, 'f1c40004-0000-4000-a000-000000000001'::uuid,
       v.ordem, v.codigo, v.nome, v.unidade, v.quantidade, v.preco_unitario, v.fornecedor
FROM (VALUES
  ('f1c40004-0000-4000-a000-000000000011'::uuid, 1, 'PL-ST-18', 'Placa de gesso ST 1,80×1,20 m',       'un',   0.93, 28.00, 'Fornecedor DEMO'),
  ('f1c40004-0000-4000-a000-000000000012'::uuid, 2, 'MT-48',    'Montante 48 mm (3 m)',                 'un',   0.80, 14.50, 'Fornecedor DEMO'),
  ('f1c40004-0000-4000-a000-000000000013'::uuid, 3, 'GU-48',    'Guia 48 mm (3 m)',                     'un',   0.70, 12.00, 'Fornecedor DEMO'),
  ('f1c40004-0000-4000-a000-000000000014'::uuid, 4, 'PF-GN25',  'Parafuso GN 25',                       'un',  24.00,  0.08, 'Fornecedor DEMO'),
  ('f1c40004-0000-4000-a000-000000000015'::uuid, 5, 'MS-JT',    'Massa para juntas (saco 20 kg)',       'saco', 0.05, 45.00, 'Fornecedor DEMO'),
  ('f1c40004-0000-4000-a000-000000000016'::uuid, 6, 'FT-PP',    'Fita de papel para juntas',            'm',    1.60,  0.35, 'Fornecedor DEMO')
) AS v(id, ordem, codigo, nome, unidade, quantidade, preco_unitario, fornecedor)
WHERE EXISTS (
  SELECT 1 FROM public.fichas_tecnicas f
  WHERE f.id = 'f1c40004-0000-4000-a000-000000000001'::uuid
)
AND NOT EXISTS (
  SELECT 1 FROM public.ficha_itens i WHERE i.id = v.id
);
