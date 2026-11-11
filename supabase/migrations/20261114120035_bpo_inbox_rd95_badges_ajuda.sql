-- BPO · Inbox do Operador (/dashboard/bpo/inbox) — RD-95: "?" (AjudaCampo) nos INDICADORES/BADGES
-- que ainda nao tinham ajuda: selo de SLA e badge "IA %" do cartao do item (ItemCard), e os badges
-- (tipo de origem, prioridade, status do SLA, categoria) + caixa "Analise da IA" do painel de detalhe
-- (DetailPanel). Antes so KPIs, filtros e "Resolver item" tinham "?". Gap do auditor aud8 (PDCA, 86/95).
-- Aditiva: so INSERE linhas de ajuda, ON CONFLICT (chave) DO NOTHING — nao altera texto publicado nem
-- toca dado de cliente. Texto em linguagem do usuario. Faixa do agente code-desenvolvedor-3 (segundos :35).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('bpo.inbox.item.ia', 'Item', 'Confianca da IA',
 'Percentual de confianca com que a IA classificou este item (quanto maior, mais segura esta a sugestao). Verde acima de 80%, dourado entre 60% e 80%, vermelho abaixo de 60%.',
 'Ajuda a decidir rapido: item com IA alta costuma so confirmar; IA baixa pede leitura atenta antes de aprovar.',
 '"IA 92%" em verde = a IA esta bem segura da classificacao. "IA 48%" em vermelho = revise com cuidado.',
 'Aprovar no automatico um item com IA baixa sem ler o contexto.', 30, '/dashboard/bpo/inbox', 'gestao_empresarial', 'publicado'),
('bpo.inbox.item.sla', 'Item', 'Prazo (SLA)',
 'Selo de prazo do item: quanto falta (min/h/d) para vencer o atendimento, ou ha quanto tempo ja venceu. Vermelho = atrasado, laranja = urgente, dourado = vence hoje, verde = dentro do prazo.',
 'Mostra a urgencia de cada item sem abrir o detalhe, para atacar primeiro o que esta estourando o prazo.',
 '"2h" em laranja = vence em 2 horas. "Atrasado 5h" em vermelho = passou 5 horas do prazo. "Sem SLA" = item sem prazo definido.',
 'Deixar para depois um item "Hoje" e ve-lo virar "Atrasado" no dia seguinte.', 31, '/dashboard/bpo/inbox', 'gestao_empresarial', 'publicado'),
('bpo.inbox.detail.tipo', 'Detalhe', 'Tipo de origem',
 'De onde o item veio: Classificacao (sugerido pela IA), Alerta (regra do sistema), Tarefa (rotina/cron), Cliente (solicitacao do cliente) ou Manual.',
 'Mostra a natureza do item, para o operador saber o que esperar antes de abrir e tratar.',
 '"CLIENTE" = chegou de uma solicitacao do cliente. "ALERTA" = o sistema detectou algo que precisa de olhar.',
 'Tratar uma solicitacao de cliente com a mesma pressa (ou falta dela) de uma tarefa de rotina.', 32, '/dashboard/bpo/inbox', 'gestao_empresarial', 'publicado'),
('bpo.inbox.detail.prioridade', 'Detalhe', 'Prioridade',
 'Nivel de prioridade do item: Urgente, Alta, Normal ou Baixa. A cor da barra lateral do cartao segue a mesma prioridade.',
 'Define a ordem de atendimento — itens urgentes/altos vem antes dos normais/baixos.',
 '"URGENTE" em vermelho = tratar primeiro. "BAIXA" = pode esperar os mais criticos.',
 'Confundir prioridade (importancia do item) com SLA (quanto falta para o prazo): sao coisas diferentes.', 33, '/dashboard/bpo/inbox', 'gestao_empresarial', 'publicado'),
('bpo.inbox.detail.sla', 'Detalhe', 'Status do prazo',
 'Situacao do item em relacao ao prazo de atendimento: Atrasado (venceu), Urgente (vence muito em breve), Hoje (vence hoje), OK (dentro do prazo) ou Sem SLA (sem prazo).',
 'Resume, em uma palavra, se o item ja estourou, esta perto de estourar ou ainda ha folga.',
 '"ATRASADO" = passou do prazo. "OK" = ainda dentro do prazo combinado.',
 'Ignorar um "URGENTE" achando que ainda ha tempo: ele esta prestes a virar atraso.', 34, '/dashboard/bpo/inbox', 'gestao_empresarial', 'publicado'),
('bpo.inbox.detail.categoria', 'Detalhe', 'Categoria',
 'Rotulo que agrupa o item por assunto (ex.: fiscal, financeiro, cadastro), quando a origem informou uma categoria.',
 'Ajuda a entender rapidamente o tema do item e a direciona-lo a quem domina o assunto.',
 '"Fiscal" = item ligado a notas/impostos. Pode nao aparecer quando a origem nao definiu categoria.',
 'Supor que todo item tem categoria: alguns chegam sem, e ai o badge nao aparece.', 35, '/dashboard/bpo/inbox', 'gestao_empresarial', 'publicado'),
('bpo.inbox.detail.ia', 'Detalhe', 'Analise da IA',
 'Resumo que a IA montou sobre o item: o contexto que ela encontrou, a acao que sugere e o percentual de confianca dessa analise.',
 'Adianta o diagnostico para o operador decidir mais rapido, sem precisar reconstruir o caso do zero.',
 '"Acao sugerida: Aprovar - Confianca 88%" = a IA recomenda aprovar e esta bem segura disso.',
 'Seguir a acao sugerida sem ler o contexto quando a confianca esta baixa.', 36, '/dashboard/bpo/inbox', 'gestao_empresarial', 'publicado')
ON CONFLICT (chave) DO NOTHING;
