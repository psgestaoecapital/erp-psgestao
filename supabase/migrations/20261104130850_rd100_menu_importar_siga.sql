-- RD-100 (CEO 01/11, INEGOCIÁVEL): nenhum nome de sistema de terceiro em nada que o usuário veja.
-- O rótulo do menu do módulo pm_importar_siga era "Importar do SIGA" — nome de terceiro visível
-- na sidebar. Generaliza para "Importar do sistema anterior" (o texto DENTRO da tela já está
-- correto desde a PR #3809). Troca só o nome; não altera rota nem dado de cliente.
-- Aditivo/idempotente: só reescreve quando o nome ainda contém o termo de terceiro.
-- Prova RD-38: contagem de linhas com "SIGA" no nome = 1 antes, 0 depois; total de linhas inalterado.
-- Code: desenvolvedor_4_g.
UPDATE public.module_catalog
   SET nome = 'Importar do sistema anterior'
 WHERE id = 'pm_importar_siga'
   AND nome ~* '\ySIGA\y';
