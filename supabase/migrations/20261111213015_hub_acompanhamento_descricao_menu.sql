-- Hub · Acompanhamento de obras — corrige a DESCRIÇÃO do item de menu.
--
-- Contexto (auditor pdca_1, via eng_chefe · tarefa 3e6c1d50):
--   A rota /dashboard/projetos/acompanhamento deixou de ser um redirect para
--   "Resultado por obra" e passou a ter CONTEÚDO PRÓPRIO na PR #4130
--   (portfólio/andamento físico das obras: avanço físico, situação do
--   cronograma, tarefas, próxima entrega, última medição e prazo por obra,
--   via fn_obras_acompanhamento).
--
--   Porém module_catalog.projetos_acompanhamento.descricao ainda diz
--   "Em construção (esqueleto)" (FALSO — a tela foi construída) e promete
--   "físico-financeiro" (a lente financeira é a tela "Resultado por obra";
--   esta é a lente de ANDAMENTO físico/cronograma).
--
-- Ação: migration ADITIVA e IDEMPOTENTE — ajusta apenas o texto da descrição
--        para a lente real da tela. Não toca tabela, função, RLS, policy,
--        menu (ativo/ordem), nem dado de cliente.
--
-- RD-38: prova no PR (BEGIN…ROLLBACK) que a linha existe e que apenas a
--        coluna `descricao` muda (1 linha afetada; ativo permanece true).

UPDATE public.module_catalog
   SET descricao = 'Avanço físico e cronograma das obras em execução: quem está em dia, quem atrasou e o que vence a seguir.'
 WHERE id = 'projetos_acompanhamento'
   AND descricao IS DISTINCT FROM 'Avanço físico e cronograma das obras em execução: quem está em dia, quem atrasou e o que vence a seguir.';
