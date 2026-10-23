-- PDCA/mapa de ligações (msg 0c4baabe, item 3): empresas DEMO de Corretora e Agro.
-- Aditivo: só INSERT (sem UPDATE/DELETE). Mesma org e ambiente das demais DEMOs (auditoria).
-- O seed de dados realistas (fn_gold_*_seed_reparar) vem em PR seguinte; aqui nasce a empresa e o mapeamento fn_demo_da_area.
INSERT INTO public.companies (id, org_id, razao_social, is_demo, ambiente_tenant)
SELECT v.id::uuid, 'c830f980-9be9-40c1-bb46-584cdc92dd65'::uuid, v.razao, true, 'auditoria'
FROM (VALUES
  ('b0700000-0000-4000-a000-000000000008', 'Corretora Modelo Demonstração LTDA'),
  ('b0700000-0000-4000-a000-000000000009', 'Fazenda Modelo Agro Demonstração LTDA')
) AS v(id, razao)
WHERE EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = 'c830f980-9be9-40c1-bb46-584cdc92dd65'::uuid)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.demo_por_area (area, company_id)
SELECT v.area, v.company_id::uuid
FROM (VALUES
  ('corretora', 'b0700000-0000-4000-a000-000000000008'),
  ('agro',      'b0700000-0000-4000-a000-000000000009')
) AS v(area, company_id)
WHERE EXISTS (SELECT 1 FROM public.companies c WHERE c.id = v.company_id::uuid AND c.is_demo = true)
ON CONFLICT DO NOTHING;
