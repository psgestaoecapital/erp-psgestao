-- P&M · tela 120 "Importar do sistema anterior": janela de 180 dias (decisão do CEO 05/10, blueprint).
-- A tela, a lib (importSiga.ts) e o gate passam a usar 180 dias; a ajuda ("?") ainda dizia 60.
-- Aditiva e idempotente: só troca "60 dias" por "180 dias" nos campos de ajuda desta tela (replace roda 2x sem efeito).
-- RD-38: as 3 linhas existem e contêm "60 dias" (pm.importacao.arquivo/mapa/previa); nada de dado de cliente é tocado.

UPDATE public.erp_ajuda_campo
   SET para_que_serve = replace(para_que_serve, '60 dias', '180 dias'),
       atualizado_em  = now()
 WHERE chave = 'pm.importacao.arquivo'
   AND para_que_serve LIKE '%60 dias%';

UPDATE public.erp_ajuda_campo
   SET erro_comum    = replace(erro_comum, '60 dias', '180 dias'),
       atualizado_em = now()
 WHERE chave = 'pm.importacao.mapa'
   AND erro_comum LIKE '%60 dias%';

UPDATE public.erp_ajuda_campo
   SET exemplo       = replace(exemplo, '60 dias', '180 dias'),
       atualizado_em = now()
 WHERE chave = 'pm.importacao.previa'
   AND exemplo LIKE '%60 dias%';
