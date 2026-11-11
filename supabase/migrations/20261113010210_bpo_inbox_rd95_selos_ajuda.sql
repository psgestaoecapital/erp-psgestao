-- BPO · Inbox do Operador (/dashboard/bpo/inbox) — RD-95: "?" (AjudaCampo) nos SELOS/indicadores que faltavam.
-- O auditor aud8 (PDCA) marcou o gap de RD-95 (nota 86/95): os KPIs, filtros e "Resolver item" já tinham "?",
-- mas os selos de SLA, prioridade, tipo de origem, categoria, o selo "IA xx%" e a caixa "Análise da IA" não.
-- Aditiva: só INSERE linhas de ajuda, ON CONFLICT (chave) DO NOTHING — não altera texto já publicado nem toca
-- dado de cliente. Texto em linguagem do usuário, 4 blocos fixos (o que mostra · para que serve · exemplo · erro comum).
-- Faixa do agente dev7claudeps (segundos :10). Lookup por rota em fn_ajuda_campo_listar.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('bpo.inbox.selo.sla', 'Selos', 'Prazo (SLA)',
 'Mostra quanto tempo falta (ou já passou) para o prazo de atendimento do item. As cores: vermelho = atrasado, laranja = urgente, dourado = vence hoje, verde = dentro do prazo.',
 'Ajuda a priorizar o que resolver primeiro — o que está atrasado ou vence hoje precisa de ação imediata.',
 '"Atrasado 3h" (passou do prazo) ou "5h" (ainda faltam 5 horas).', 'Ignorar um item verde achando que não tem prazo: ele só está dentro do prazo, não é "sem SLA".', 11, '/dashboard/bpo/inbox', 'gestao_empresarial', 'publicado'),
('bpo.inbox.selo.ia', 'Selos', 'Confiança da IA',
 'O quanto a inteligência artificial confia na ação que ela sugeriu para o item, de 0 a 100%. Verde (≥80%) = alta confiança; dourado (60–79%) = média; vermelho (<60%) = baixa.',
 'Indica se você pode seguir a sugestão da IA com mais tranquilidade ou se vale conferir com atenção antes de decidir.',
 '"IA 92%" = a IA está bem segura da sugestão.', 'Aprovar direto um item de confiança baixa sem ler a análise: quanto menor o percentual, mais convém revisar.', 12, '/dashboard/bpo/inbox', 'gestao_empresarial', 'publicado'),
('bpo.inbox.selo.tipo', 'Selos', 'Tipo de origem',
 'De onde o item veio: Classificação IA (a IA separou), Alerta (regra do sistema), Tarefa (rotina/cron), Manual (alguém criou) ou Cliente (solicitação do cliente).',
 'Mostra a natureza do item para você saber o que esperar e como tratar — um pedido de cliente é diferente de um alerta automático.',
 '"CLIENTE" = veio de uma solicitação do cliente.', 'Tratar uma "TAREFA" de rotina com a mesma urgência de uma solicitação de cliente.', 13, '/dashboard/bpo/inbox', 'gestao_empresarial', 'publicado'),
('bpo.inbox.selo.prioridade', 'Selos', 'Prioridade',
 'A importância do item: Urgente, Alta, Normal ou Baixa. A barra colorida na lateral do card repete essa cor.',
 'Orienta a ordem de atendimento — itens urgentes e de alta prioridade vêm antes dos normais.',
 '"URGENTE" (vermelho) = atender assim que possível.', 'Confundir prioridade com prazo (SLA): são coisas diferentes — um item pode ser de baixa prioridade e ainda assim estar atrasado.', 14, '/dashboard/bpo/inbox', 'gestao_empresarial', 'publicado'),
('bpo.inbox.selo.categoria', 'Selos', 'Categoria',
 'O assunto/classificação do item, quando houver (ex.: fiscal, cobrança, cadastro). Aparece só nos itens que têm categoria definida.',
 'Agrupa os itens por tema para você entender rápido do que se trata sem abrir a descrição.',
 '"Cobrança" = o item é sobre cobrança.', 'Estranhar um item sem categoria: nem todo item é categorizado — isso não é erro.', 15, '/dashboard/bpo/inbox', 'gestao_empresarial', 'publicado'),
('bpo.inbox.analise_ia', 'Detalhe', 'Análise da IA',
 'O resumo que a inteligência artificial montou sobre o item: o contexto que ela leu, o percentual de confiança e a ação que ela sugere (aprovar, rejeitar ou escalar).',
 'Dá a você uma leitura pronta do caso para decidir mais rápido — mas a decisão final de aprovar, rejeitar ou escalar é sempre sua.',
 'A IA sugere "Aprovar" com 88% de confiança e explica o porquê no texto.', 'Seguir a sugestão sem ler o contexto: a IA pode não ter visto um detalhe que só você conhece.', 16, '/dashboard/bpo/inbox', 'gestao_empresarial', 'publicado')
ON CONFLICT (chave) DO NOTHING;
