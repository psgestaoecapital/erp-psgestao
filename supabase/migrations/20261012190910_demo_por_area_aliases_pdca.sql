-- PDCA/mapa de ligações (msg 0c4baabe): fn_demo_da_area precisa resolver os nomes de vertical usados no catálogo.
-- Aditivo: só INSERT de apelidos de área apontando para DEMOs que já existem (is_demo). Sem UPDATE/DELETE.
-- Oficina duplicada (…01 × Mecânica Modelo) NÃO é tocada aqui: aguarda combinação com o rodrigo-code.
INSERT INTO public.demo_por_area (area, company_id)
SELECT v.area, v.company_id::uuid
FROM (VALUES
  ('revenda_veiculos', 'b0700000-0000-4000-a000-000000000003'),
  ('ge',               'b0700000-0000-4000-a000-000000000004'),
  ('ehs',              'b0700000-0000-4000-a000-000000000005'),
  ('industria',        'b0700000-0000-4000-a000-000000000005')
) AS v(area, company_id)
WHERE EXISTS (SELECT 1 FROM public.companies c WHERE c.id = v.company_id::uuid AND c.is_demo = true)
ON CONFLICT DO NOTHING;
