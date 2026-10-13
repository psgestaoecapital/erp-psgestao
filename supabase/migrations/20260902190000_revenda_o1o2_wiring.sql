-- Revenda de Veículos · Ondas 1-2 · registro do módulo (§6.1/§6.2).
-- Grupo commerce (a revenda é comércio com regra própria — não cria vertical nova). Subgrupo novo.

INSERT INTO public.module_subgrupos (id, grupo, label, ordem, ativo)
VALUES ('revenda_veiculos', 'commerce', 'Revenda de Veículos', 187, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.module_catalog (id, nome, rota, grupo, subgrupo, icone, ordem, ativo, is_shared, surface_in_groups)
VALUES
  ('revenda_patio', 'Revenda · Pátio', '/dashboard/revenda/patio', 'commerce', 'revenda_veiculos', 'Car', 187, true, true, ARRAY[]::text[]),
  ('revenda_veiculo', 'Revenda · Ficha do veículo', '/dashboard/revenda/veiculo', 'commerce', 'revenda_veiculos', 'FileText', 188, true, true, ARRAY[]::text[])
ON CONFLICT (id) DO NOTHING;
