-- BPO · Supervisor Dashboard (/dashboard/bpo/supervisor) — RD-95: "?" (AjudaCampo) nas COLUNAS da tabela
-- "Visao por Empresa" e nas estatisticas do card de operador, que nao tinham ajuda (so KPIs e titulos de secao tinham).
-- Gap do auditor aud8 (PDCA, nota 82/95). Aditiva: so INSERE linhas de ajuda, ON CONFLICT (chave) DO NOTHING —
-- nao altera texto ja publicado nem toca dado de cliente. Texto em linguagem do usuario, 4 blocos fixos.
-- Faixa do agente dev7claudeps (segundos :10). Lookup por rota em fn_ajuda_campo_listar.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('bpo.supervisor.col.total', 'Colunas', 'Total',
 'Quantidade de itens pendentes (ainda nao resolvidos) da empresa, somando todas as prioridades e prazos.',
 'Mostra a carga de trabalho em aberto de cada empresa, para comparar quem tem mais fila.',
 '"18" = a empresa tem 18 itens pendentes.', 'Confundir Total (tudo em aberto) com Atraso (so os que passaram do prazo).', 20, '/dashboard/bpo/supervisor', 'gestao_empresarial', 'publicado'),
('bpo.supervisor.col.atraso', 'Colunas', 'Atraso',
 'Quantos itens da empresa ja passaram do prazo de atendimento (SLA vencido). Aparece em vermelho quando ha algum.',
 'Aponta onde o prazo estourou — e o que precisa de acao imediata do operador.',
 '"3" em vermelho = 3 itens atrasados. "-" = nenhum atrasado.', 'Ignorar o "-" achando que e erro: o traco significa zero atrasados (bom sinal).', 21, '/dashboard/bpo/supervisor', 'gestao_empresarial', 'publicado'),
('bpo.supervisor.col.urgente', 'Colunas', 'Urgente',
 'Quantos itens da empresa estao marcados como urgentes (prazo muito proximo), ainda dentro do prazo.',
 'Avisa o que vai virar atraso em breve, para priorizar antes de estourar.',
 '"2" = 2 itens urgentes aguardando. "-" = nenhum.', 'Deixar os urgentes para depois e ve-los virarem atraso.', 22, '/dashboard/bpo/supervisor', 'gestao_empresarial', 'publicado'),
('bpo.supervisor.col.hoje', 'Colunas', 'Hoje',
 'Quantos itens da empresa vencem ainda hoje (prazo termina no dia de hoje).',
 'Mostra o que precisa fechar hoje para nao virar atraso amanha.',
 '"5" = 5 itens vencem hoje. "-" = nenhum para hoje.', 'Tratar "Hoje" como ja atrasado: ainda da tempo, mas so ate o fim do dia.', 23, '/dashboard/bpo/supervisor', 'gestao_empresarial', 'publicado'),
('bpo.supervisor.col.sem_op', 'Colunas', 'Sem op',
 'Quantos itens da empresa ainda nao tem um operador responsavel atribuido.',
 'Mostra o que esta sem dono — item sem operador tende a ficar parado. Supervisor deve atribuir.',
 '"4" em vermelho = 4 itens sem operador. "-" = todos atribuidos.', 'Esquecer os "sem op": sem responsavel, ninguem resolve.', 24, '/dashboard/bpo/supervisor', 'gestao_empresarial', 'publicado'),
('bpo.supervisor.col.concluidos', 'Colunas', 'Concluidos',
 'Quantos itens da empresa foram resolvidos hoje (aprovados, rejeitados ou escalados).',
 'Mede a vazao do dia por empresa — quanto a equipe ja entregou hoje.',
 '"12" = 12 itens concluidos hoje.', 'Somar concluidos com pendentes achando que e o total do dia: sao contagens separadas.', 25, '/dashboard/bpo/supervisor', 'gestao_empresarial', 'publicado'),
('bpo.supervisor.op.pendentes', 'Operadores', 'Pendentes (operador)',
 'Quantos itens pendentes estao atribuidos a este operador, somando todas as empresas dele.',
 'Mostra a carga individual de cada operador, para equilibrar a distribuicao de trabalho.',
 '"9" = o operador tem 9 itens em aberto.', 'Comparar operadores sem olhar quantas empresas cada um atende (coluna "empresas atribuidas").', 26, '/dashboard/bpo/supervisor', 'gestao_empresarial', 'publicado'),
('bpo.supervisor.op.atrasados', 'Operadores', 'Atrasados (operador)',
 'Quantos itens do operador ja passaram do prazo. A barra lateral do card fica vermelha quando ha algum.',
 'Aponta qual operador esta com itens vencidos — sinal de sobrecarga ou de item travado.',
 '"2" = o operador tem 2 itens atrasados.', 'Cobrar o operador sem ver se ele tem empresas demais atribuidas.', 27, '/dashboard/bpo/supervisor', 'gestao_empresarial', 'publicado'),
('bpo.supervisor.op.concluidos', 'Operadores', 'Concluidos (operador)',
 'Quantos itens este operador resolveu hoje (aprovados, rejeitados ou escalados).',
 'Mede a produtividade do dia de cada operador.',
 '"15" = o operador resolveu 15 itens hoje.', 'Avaliar so pelo numero sem considerar a complexidade dos itens de cada um.', 28, '/dashboard/bpo/supervisor', 'gestao_empresarial', 'publicado')
ON CONFLICT (chave) DO NOTHING;
