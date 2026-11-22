-- Hub · tela 310 (Painel de abertura, "Obras por situação"): blueprint §310 "Bloco de obras" pede
-- "ativas, concluídas, ATRASADAS e em pós-obra". O painel trazia as obras por status (em andamento,
-- pausadas, concluídas, canceladas), mas não o alerta de PRAZO: obra em andamento cujo término previsto
-- (projetos_obras.data_prevista_fim) já passou. Esta fatia (front-only) acrescenta o alerta "Obras
-- atrasadas" no topo da seção, visível só quando há atraso (RD-98 — zero não vira alarme falso).
-- Esta migration apenas semeia o "?" (RD-95) do novo alerta. Não há seed de dado: a DEMO do Hub (...006)
-- já tem obra em andamento com prazo vencido (provado no dado), tornando o alerta demonstrável.
-- Aditiva e idempotente (ON CONFLICT (chave) DO NOTHING); catálogo de ajuda, não toca dado de cliente.
-- RD-100: sem nome de terceiro. Linguagem do usuário (gestor de obra).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.painel.obras.atrasadas', '/dashboard/projetos', 'Obras por situação',
   'Obras atrasadas',
   'Conta as obras em andamento cujo prazo previsto de término (data prevista de fim) já passou da data de hoje.',
   'É o alerta de prazo do Hub: mostra, logo na abertura, quais obras estourarão (ou já estouraram) o cronograma, para você agir antes do cliente cobrar. Clique para abrir a lista de obras em andamento e rever prazo e avanço.',
   'Clique para abrir as obras em andamento e revisar o cronograma das que estão vencidas.',
   'Achar que inclui obras concluídas ou pausadas: entram só as que estão em andamento e cujo término previsto já passou. Uma obra sem data prevista de fim não é contada.',
   'hub_projetos', 32, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
