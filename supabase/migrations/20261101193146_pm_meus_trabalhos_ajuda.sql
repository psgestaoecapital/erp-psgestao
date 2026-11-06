-- RD-95: "?" do agrupamento (abas) e da coluna Situação da tela Meus trabalhos (P&M · /dashboard/pm/meus-trabalhos).
-- Aditiva: só INSERT de texto de ajuda, idempotente (ON CONFLICT na chave única). Sem RLS/policy/grant novos.
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
('pm.meus_trabalhos.agrupar','/dashboard/pm/meus-trabalhos','Meus trabalhos · Lista','Agrupamento',
 'Escolha como ver a lista: Por prazo (vence antes primeiro), Por início (começa antes) ou Por situação (fase do job).',
 'Troca a ordem/agrupamento sem mudar o que é seu — só reorganiza para você atacar o que é mais urgente.',
 'Virada de semana: use Por prazo para ver o que vence; começo de job: Por início.',
 'Achar que muda os jobs listados: só muda a ORDEM/agrupamento; a lista continua sendo só o que é seu.',
 'pm',7,1,'publicado'),
('pm.meus_trabalhos.situacao','/dashboard/pm/meus-trabalhos','Meus trabalhos · Lista','Situação',
 'A etiqueta ao lado de cada job mostra a fase atual dele (em produção, em aprovação, publicado…).',
 'Dá o estado de cada trabalho de relance, sem abrir o job, para saber o que depende de você agora.',
 '"Em aprovação" = aguardando o OK do cliente; "Em produção" = equipe trabalhando.',
 'Confundir a situação do job com a sua tarefa: a etiqueta é a fase do job, não o status da sua tarefa.',
 'pm',8,1,'publicado')
ON CONFLICT (chave) DO NOTHING;
