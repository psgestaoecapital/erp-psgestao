-- Remove do menu ESTOQUE o item PREVISTO "Inventarios" (placeholder sem uso).
-- O inventario real fica em Estoque & Curva ABC > aba Inventario (/dashboard/commerce/estoque).
-- So catalogo de menu: nao toca erp_inventarios / erp_inventario_itens. Rota e a pagina generica de "previsto".
UPDATE public.module_catalog SET ativo = false WHERE id = 'ge_prev_estoque_inventarios';
