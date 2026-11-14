-- RD-38/RD-95 · /dashboard/pm/bot (card "pm.bot.proximo")
-- A fatia 3 (20261106170015) ligou o disparo automático por evento (triggers
-- trg_pm_bot_job_ins/upd em agency_jobs + cron pm-bot-scan-prazos-diario) e já
-- corrigiu `o_que_preencher`/`exemplo` desta chave, mas deixou `rotulo`,
-- `para_que_serve` e `erro_comum` com o texto pré-gatilhos, que ainda dizia que o
-- envio automático "chega na próxima fatia" — hoje isso é falso.
-- Esta migration alinha os 3 campos restantes à verdade.
-- Aditivo e idempotente: UPDATE por chave única; não altera schema, RLS nem dado
-- de cliente. Prova RD-38 (BEGIN/ROLLBACK em produção): 1 linha afetada.
UPDATE public.erp_ajuda_campo
   SET rotulo = 'O que o bot já faz',
       para_que_serve = 'Resume o que a V1 do bot já entrega: conectar o canal, escolher os avisos, o disparo automático por evento, o envio de teste e o histórico.',
       erro_comum = 'Achar que os avisos só saem ao clicar em "testar": os avisos marcados disparam sozinhos quando o fato acontece (novo job, aprovação pendente, prazo em 24h, job atrasado, estouro de horas).'
 WHERE chave = 'pm.bot.proximo';
