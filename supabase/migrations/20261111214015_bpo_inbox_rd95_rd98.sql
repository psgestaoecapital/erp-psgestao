-- BPO · Inbox do Operador (/dashboard/bpo/inbox) — aud8 70/95.
-- Gaps de código fechados no mesmo PR (front, aditivo):
--   RD-95 "?": AjudaCampo em cada KPI (Total/Atrasados/Urgentes/Hoje), em cada filtro
--   (Buscar/Empresa/Prioridade/Tipo), na ação Atualizar e na ação Resolver item (Aprovar/Rejeitar/Escalar);
--   RD-98 p3 (ESTA migration): origem do dado em system_screens (RPCs da tela).
-- Obs.: o item do auditor "rota renderiza painel financeiro / R$0 nos cards" é leitura STALE —
--   a tela atual é o "Inbox do Operador" (KPIs por CONTAGEM, sem valores em R$) com header próprio.
-- ADITIVA/idempotente, NÃO altera dado de cliente, RLS/grant/RPC. Faixa dev7claudeps (segundos :15), acima da main.

-- ── (1) RD-95: chaves de ajuda dos indicadores/filtros/ações ──────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/bpo/inbox', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('bpo.inbox.kpi.total','Indicadores','Total','Quantidade de tarefas abertas na sua caixa (todas as empresas que você atende).','Dá, num número só, o tamanho da fila que está sob sua responsabilidade.','"18" = 18 tarefas aguardando você.','Conta as tarefas abertas, não as já concluídas.',1),
 ('bpo.inbox.kpi.atrasados','Indicadores','Atrasados','Tarefas cujo prazo (SLA) já venceu.','Mostra o que precisa de ação imediata para não estourar o acordo com o cliente.','"3" = 3 tarefas vencidas.','Atrasado é medido pelo prazo da tarefa, não pela hora em que ela chegou.',2),
 ('bpo.inbox.kpi.urgentes','Indicadores','Urgentes','Tarefas marcadas como urgentes ou que vencem em poucas horas.','Separa o que fura a fila e deve ser feito antes.','"2" = 2 urgências abertas.','—',3),
 ('bpo.inbox.kpi.hoje','Indicadores','Hoje','Tarefas com prazo para hoje.','Ajuda a planejar o que precisa sair até o fim do dia.','"7" = 7 vencem hoje.','—',4),
 ('bpo.inbox.filtro.busca','Filtros','Buscar','Digite parte do título da tarefa para filtrar a lista.','Encontra rápido uma tarefa específica sem rolar toda a caixa.','Digite "folha" para ver só as tarefas de folha.','A busca é só pelo título — não procura dentro da descrição.',5),
 ('bpo.inbox.filtro.empresa','Filtros','Empresa','Escolha uma empresa para ver só as tarefas dela.','Foca o trabalho numa empresa da sua carteira por vez.','Selecione "Padaria X" para ver só as pendências dela.','A lista mostra apenas as empresas que têm tarefa aberta agora.',6),
 ('bpo.inbox.filtro.prioridade','Filtros','Prioridade','Filtra por nível de prioridade (urgente, alta, normal, baixa).','Permite atacar primeiro o que é mais crítico.','Selecione "Urgente" para ver só o que não pode esperar.','—',7),
 ('bpo.inbox.filtro.tipo','Filtros','Tipo','Filtra pela origem da tarefa (classificação da IA, alerta, rotina ou solicitação do cliente).','Separa, por exemplo, só as solicitações de cliente das tarefas automáticas.','Selecione "Solicitação cliente" para ver os pedidos que chegaram do cliente.','O padrão é "Alerta"; mude para "Todos tipos" se não encontrar uma tarefa.',8),
 ('bpo.inbox.acao.atualizar','Ações','Atualizar','Recarrega a caixa com as tarefas mais recentes do banco.','Garante que você está vendo a fila atual, sem precisar sair da tela.','Clique após concluir várias tarefas para ver a lista atualizada.','—',9),
 ('bpo.inbox.acao.resolver','Ações','Resolver item','Define o desfecho da tarefa aberta: Aprovar (executa a ação sugerida), Rejeitar (descarta) ou Escalar (encaminha para supervisão).','Fecha a tarefa com rastro — a resolução é registrada em log de auditoria.','Em uma classificação da IA, "Aprovar" confirma a sugestão; "Escalar" manda para o supervisor decidir.','A ação é registrada no histórico e não pode ser desfeita pela tela — escale em caso de dúvida.',10)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);

-- ── (2) RD-98 p3: origem do dado da tela (RPCs consumidas) ─────────────────────────────────────────────────────────
-- A tela lê a caixa por fn_inbox_operador e resolve itens por fn_inbox_resolver; a ajuda vem de fn_ajuda_campo_listar.
-- Não consome VIEW diretamente (lê a tabela users + as RPCs), por isso views_consumidas fica como lista vazia (não-nula).
UPDATE public.system_screens
SET views_consumidas = COALESCE(views_consumidas, ARRAY[]::text[]),
    rpcs_chamadas = ARRAY['fn_inbox_operador','fn_inbox_resolver','fn_ajuda_campo_listar']::text[]
WHERE rota = '/dashboard/bpo/inbox'
  AND (views_consumidas IS NULL OR rpcs_chamadas IS NULL);
