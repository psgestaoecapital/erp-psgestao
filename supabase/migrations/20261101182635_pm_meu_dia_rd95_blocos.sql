-- RD-95 (CEO 08/10): "?" em cada bloco/indicador da tela Meu Dia (P&M) · /dashboard/pm/meu-dia.
-- O auditor PDCA (aud8 82/95, 31/10) apontou vários estados vazios e pediu AjudaCampo nos blocos. A textarea
-- de anotação e o cronômetro já tinham "?". Este texto explica cada bloco E por que ele pode aparecer vazio
-- (RD-98 pilar 1: vazio real × bug de leitura) — resolve a dúvida sem sair da tela, sem mexer na leitura do dado.
-- Aditivo: só texto em erp_ajuda_campo (sem tabela nova, sem RLS, sem dado de cliente). Idempotente (ON CONFLICT chave).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/pm/meu-dia', 'pm', 'publicado'
FROM (VALUES
 ('pm.dia.resumo_topo', 'Meu dia · Resumo', 'Resumo do dia',
  'Indicador só de leitura: a contagem de jobs atrasados, dos que vencem hoje e das menções recentes para você.',
  'Dá o retrato do seu dia de relance, logo ao abrir a tela, antes de descer para os blocos detalhados.',
  '2 atrasado(s) · 3 para hoje · 1 menção(ões).',
  'Achar que o número some sozinho: ele reflete os seus jobs — cai quando você conclui ou reagenda as tarefas.',
  1),
 ('pm.dia.o_que_e_meu', 'Meu dia · O que é meu', 'O que é meu',
  'Lista só de leitura dos seus jobs em aberto, separados em Atrasados, Hoje e Próximos dias (mesma regra da Pauta, atalho "meus").',
  'Mostra no que você precisa trabalhar hoje, por prioridade de prazo, com atalho para abrir cada job na Pauta e o Play para cronometrar.',
  '"Nada vencendo hoje" aparece quando nenhum job seu tem prazo para hoje.',
  'Ler o vazio como erro: a lista vem dos seus jobs na Pauta — vazia significa que não há job seu com aquele prazo, não falta de leitura.',
  2),
 ('pm.dia.aprovacoes', 'Meu dia · Aprovações', 'Aprovações dos meus jobs',
  'Lista só de leitura dos seus jobs que estão "em aprovação", com o prazo de cada aprovação (vencida / hoje / em dia).',
  'Avisa quais entregas suas dependem de um aprovador para andar, destacando as que já venceram, para você cobrar a tempo.',
  '"Nenhuma aprovação aberta" quando nenhum job seu está aguardando decisão.',
  'Esperar ver aqui aprovações de jobs de outras pessoas: o bloco é só dos SEUS jobs em aprovação.',
  3),
 ('pm.dia.acoes', 'Meu dia · Ações', 'Minhas últimas ações',
  'Histórico só de leitura das suas ações recentes: horas lançadas, comentários e ações em massa na Pauta.',
  'Deixa você retomar de onde parou e confere o que já registrou hoje, reunindo horas, comentários e lotes num só lugar.',
  'Verde = horas · dourado = comentário · vermelho = ação em massa.',
  'Estranhar "Nada ainda hoje": é real quando você ainda não lançou horas nem comentou — aparece assim que registrar a primeira ação.',
  4),
 ('pm.dia.mencoes', 'Meu dia · Menções', 'Menções para mim',
  'Lista só de leitura dos comentários dos últimos 7 dias em que alguém citou você com @ num job.',
  'Garante que você não perca um pedido direto feito num comentário de job, com o autor, a data e o trecho em destaque.',
  '"Ninguém te chamou nos últimos 7 dias" quando não houve menção a você no período.',
  'Achar que lista menções antigas: a janela é de 7 dias — citações mais velhas não aparecem aqui.',
  5),
 ('pm.dia.anotacoes', 'Meu dia · Anotações', 'Minhas anotações',
  'Suas anotações privadas (só você vê, nem o gestor). Fixe no topo com o alfinete ou arquive com a caixa.',
  'Guarda lembretes pessoais do dia junto do seu trabalho — fixar deixa o mais importante sempre à vista.',
  'Fixar "ligar para a Clínica Sorriso às 15h" para não esquecer.',
  'Arquivar achando que exclui de vez: o arquivar é rastreável (soft-delete) — a anotação sai da lista mas não é apagada fisicamente.',
  6)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;
