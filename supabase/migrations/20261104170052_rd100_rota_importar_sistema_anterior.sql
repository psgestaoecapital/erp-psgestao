-- RD-100 (CEO 01/11, INEGOCIÁVEL): rota VISÍVEL com nome de terceiro.
-- /dashboard/pm/importar-siga -> /dashboard/pm/importar-sistema-anterior.
-- O redirect 308 do caminho antigo está em next.config.ts (preserva query string).
-- Aqui alinhamos os metadados: rota do módulo no menu e da tela no inventário.
-- Aditiva/idempotente (só troca quando ainda está no caminho antigo); não toca dado de cliente.
-- Prova RD-38: 1 linha com a rota antiga antes em cada tabela, 0 depois; nº de linhas inalterado.

UPDATE public.module_catalog
   SET rota = '/dashboard/pm/importar-sistema-anterior'
 WHERE id = 'pm_importar_siga'
   AND rota = '/dashboard/pm/importar-siga';

UPDATE public.system_screens
   SET rota = '/dashboard/pm/importar-sistema-anterior'
 WHERE rota = '/dashboard/pm/importar-siga';
