-- PDCA Compliance · /dashboard/ehs/epi/alertas (aud8 90/95) · RD-95: "?" nas ações (Resolver/Ignorar) e no card de alerta.
-- ADITIVA: só textos de ajuda novos (erp_ajuda_campo). Não cria/altera tabela, RLS, policy, grant ou dado de cliente.
-- Idempotente (ON CONFLICT (chave) DO NOTHING).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'compliance', 'publicado'
FROM (VALUES
 ('compliance.epi.alertas.card', 'Alertas EPI', 'Card de alerta', 'Nada a preencher: cada card é um alerta aberto (CA vencido, estoque crítico, entrega pendente…) com o funcionário, o EPI e a data.', 'Mostra o que precisa de atenção agora na gestão de EPIs; o traço colorido à esquerda indica a severidade (vermelho = crítica).', 'Card "CA vencido" ligado ao colaborador João e ao EPI Luva nitrílica, aberto hoje.', 'Ignorar um card crítico achando que é só informativo: alerta crítico costuma exigir ação imediata.', 10, '/dashboard/ehs/epi/alertas'),
 ('compliance.epi.alertas.acao_resolver', 'Alertas EPI', 'Resolver', 'Toque em Resolver quando a causa do alerta já foi tratada (repôs o estoque, trocou o EPI, atualizou o CA).', 'Marca o alerta como resolvido e o tira da lista de ativos, registrando que o problema foi corrigido.', 'Resolver "Estoque crítico" depois de dar entrada em novas luvas.', 'Resolver sem ter corrigido de fato: o alerta pode reabrir na próxima verificação e some do radar enquanto isso.', 11, '/dashboard/ehs/epi/alertas'),
 ('compliance.epi.alertas.acao_ignorar', 'Alertas EPI', 'Ignorar', 'Toque em Ignorar quando o alerta não se aplica ao seu caso e você não vai agir sobre ele.', 'Tira o alerta da lista de ativos sem marcá-lo como corrigido — serve para dispensar falso-positivo, não para esconder pendência real.', 'Ignorar um alerta de EPI que a empresa deixou de usar.', 'Usar Ignorar no lugar de Resolver: Ignorar não registra que o problema foi tratado.', 12, '/dashboard/ehs/epi/alertas')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
