-- /dashboard/pm/bot — honestidade de menu e ajuda (RD-38)
--
-- Contexto (auditor PDCA, provado no dado — DEMO b0700000-0000-4000-a000-000000000002):
--   * A V1 do bot é SÓ Slack; não existe integração WhatsApp. O menu dizia
--     "Bot WhatsApp/Slack" e prometia o que não entrega (gap 3).
--   * A entrega ao Slack ainda NÃO está ativa: 148 envios presos em
--     'enfileirado' (0 com enviado_em), edge pm-bot-enviar responde 401.
--     O texto de ajuda pm.bot.proximo afirmava que o aviso "já chega no Slack"
--     e "dispara sozinho" — falso na entrega (gap 2, parte da ajuda).
--
-- Esta migration só reescreve textos de REFERÊNCIA/AJUDA (module_catalog e
-- erp_ajuda_campo) — dados globais do produto, sem company_id, sem dado de
-- cliente, sem RLS/policy/grant. Idempotente (UPDATE por chave/id).

-- Gap 3 — nome do menu honesto: V1 é só Slack.
UPDATE module_catalog
   SET nome = 'Bot no Slack'
 WHERE id = 'pm_bot_produtividade'
   AND nome = 'Bot WhatsApp/Slack';

-- Gap 2 (ajuda) — pm.bot.proximo deixa de prometer entrega automática já ativa.
UPDATE erp_ajuda_campo
   SET para_que_serve = 'Resume o que a V1 do bot já entrega: conectar o canal, escolher os avisos e a detecção automática por evento. A entrega ao Slack está sendo ativada — por enquanto os avisos detectados ficam na fila e aparecem no histórico.',
       erro_comum     = 'Achar que o aviso já chega no Slack: hoje o evento é detectado e enfileirado (novo job, aprovação pendente, prazo em 24h, job atrasado, estouro de horas), mas a entrega ao Slack ainda está sendo ativada, então o aviso fica "Na fila" no histórico.',
       exemplo        = 'Ligue o aviso "Novo job": ao cadastrar um job, o evento entra na fila e aparece aqui no histórico. Quando a entrega estiver no ar, a mensagem passa a chegar no canal do Slack automaticamente.'
 WHERE chave = 'pm.bot.proximo';
