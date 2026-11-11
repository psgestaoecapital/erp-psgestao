-- Lease zumbi / Codes travados (CEO 10/11) — AGENDAR o detector de sessão morta.
--
-- Auditoria (RD-38):
--  1) fn_agente_sessao_iniciar JÁ considera morta e sobrescreve uma lease não renovada há > 12 min
--     (provado: lease de 20 min -> a nova sessão PEGA, retorna 'ok'). O fix pedido para essa função já existe.
--  2) O problema real é que fn_agente_detectar_sessao_morta — que LIMPA lease fantasma (> 10 min sem renovar
--     com tarefa esperando), RE-ENFILEIRA tarefa órfã (em_andamento parada > 15 min sem lease viva -> volta a
--     'recebida') e RE-ACIONA o Code — NÃO estava agendada em nenhum cron. Então a lease zumbi e as tarefas
--     presas de rodrigo-code/jordana-code/4_g ficavam sem auto-cura.
--
-- Prova (detector em modo SIMULAR, não altera nada): no momento desta migration ele re-enfileiraria 9 tarefas
-- órfãs (7 do rodrigo-code, 1 do desenvolvedor_4_g, 1 do gilberto-revisor) e limparia 1 lease fantasma.
--
-- Esta migration agenda o detector a cada 5 min (idempotente: cron.schedule faz upsert pelo nome).
-- Observação para o Eng. Chefe: o despertador 'esteira-dono-5min' (jobid 78, fn_agente_acionar) está
-- DESATIVADO (active=false). NÃO o reativo aqui por ser decisão de infra — o detector já re-aciona os Codes
-- com lease fantasma e tarefa esperando; se o despertador normal deve voltar, é uma decisão à parte.

SELECT cron.schedule(
  'detector-sessao-morta-5min',
  '*/5 * * * *',
  $cron$SELECT public.fn_agente_detectar_sessao_morta();$cron$
);
