-- Menu ESTOQUE: tira o item PREVISTO "Inventarios" (placeholder sem tela).
-- O inventario real fica em Estoque & Curva ABC > aba Inventario (/dashboard/commerce/estoque).
-- Pedido do Rodrigo (Canal PS). So menu: nao mexe em erp_inventarios / erp_inventario_itens.
-- Padrao RD-52 (centros de custo): desativa o modulo, sem apagar historico do catalogo.
UPDATE public.module_catalog
   SET ativo = false
 WHERE id = 'ge_prev_estoque_inventarios'
   AND ativo IS DISTINCT FROM false;
