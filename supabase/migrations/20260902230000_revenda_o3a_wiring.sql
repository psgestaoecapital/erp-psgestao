-- Revenda de Veículos · Onda 3A · registro do módulo de Vendas.
-- Negociação (reserva/venda/entrega) acontece na ficha do veículo (já registrada na Onda 1-2);
-- a lista de Vendas ganha entrada própria no menu. Mesmo grupo/subgrupo das Ondas 1-2.

INSERT INTO public.module_catalog (id, nome, rota, grupo, subgrupo, icone, ordem, ativo, is_shared, surface_in_groups)
VALUES ('revenda_vendas', 'Revenda · Vendas', '/dashboard/revenda/vendas', 'commerce', 'revenda_veiculos', 'ReceiptText', 189, true, true, ARRAY[]::text[])
ON CONFLICT (id) DO NOTHING;
