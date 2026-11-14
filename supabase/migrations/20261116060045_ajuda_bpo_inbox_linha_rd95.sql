-- RD-95: "?" por LINHA na lista "Para tratar hoje" do Inbox do BPO (/dashboard/bpo/inbox).
-- Gap do auditor (14/11): cada linha é uma pendência (Lançamentos sem conta, A pagar em atraso,
-- Despesas sem categoria, anti-fraude, conciliação, fechamento...) com botão Resolver, mas sem "?"
-- explicando o que é aquele tipo de pendência. Os "?" existentes cobrem selos/filtros/ação genérica,
-- não a própria linha. Este "?" fica ao lado do título de cada item e descreve os tipos de pendência.
-- Aditivo: só INSERT de texto (ON CONFLICT (chave) DO NOTHING), nunca altera dado de cliente.
-- Agente desenvolvedor_4_g (faixa de segundos :45–:54).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES (
  'bpo.inbox.linha', 'Lista', 'Pendência (linha)',
  'Cada linha é uma pendência a tratar. O título diz o que resolver e o tipo mais comum aparece no selo Categoria (ex.: A pagar em atraso = contas a pagar vencidas; Lançamentos sem conta = classificação pendente; Despesas sem categoria = classificação; Conciliação = extrato x lançamentos; Anti-fraude = alerta de risco; Fechamento/DRE = pendência do mês). Clique na linha para ver o detalhe e o botão Resolver.',
  'Organiza o trabalho do dia por prioridade e prazo (SLA): a linha mostra a empresa, o resumo da pendência e quanto falta para o prazo, para você atacar primeiro o que está atrasado ou urgente.',
  'Uma linha "A pagar em atraso — Fornecedor X" em vermelho de SLA: clicar abre o detalhe, mostra a análise da IA e os botões Aprovar / Rejeitar / Escalar para resolver.',
  'Achar que a lista está incompleta: o filtro Tipo vem em "Alertas" por padrão (esconde as tarefas de sistema); troque o filtro para ver todas as pendências.',
  0, '/dashboard/bpo/inbox', 'gestao_empresarial', 'publicado'
)
ON CONFLICT (chave) DO NOTHING;
