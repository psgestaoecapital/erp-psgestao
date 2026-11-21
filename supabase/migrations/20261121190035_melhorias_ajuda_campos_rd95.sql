-- Central de Melhorias (/dashboard/melhorias) · "?" por campo (RD-95), auditoria aud8claudeps 19/11.
-- O formulário "Registrar uma dificuldade" só tinha "?" no campo "Em qual tela acontece?"
-- (chamado.tela_informada). Esta migration cadastra os 4 textos de ajuda que faltavam —
-- Tipo, Prioridade, Título e Descrição — para o componente padrão AjudaCampo.
-- Aditiva/idempotente: só texto de ajuda novo (erp_ajuda_campo), sem dado de cliente.
-- Faixa :35 (code-desenvolvedor-3). ON CONFLICT (chave) DO NOTHING garante reexecução segura.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('chamado.tipo', 'Chamados', 'Tipo',
  'Escolha o que você está registrando: uma dificuldade/erro que travou seu trabalho, ou uma ideia de melhoria para a tela.',
  'Direciona o chamado para a fila certa — erro vira prioridade de correção; melhoria entra no planejamento do produto.',
  'Travou ao salvar uma nota fiscal → "Erro/dificuldade". Queria um filtro novo na lista → "Melhoria".',
  'Marcar como "Melhoria" algo que está impedindo o trabalho agora: isso atrasa o atendimento. Em dúvida, escolha "Erro/dificuldade".',
  3, '/dashboard/melhorias'),
 ('chamado.prioridade', 'Chamados', 'Prioridade',
  'Diga o quanto isso te atrapalha hoje: baixa (dá para esperar), normal (atrapalha mas tem jeito), alta (trava uma tarefa importante).',
  'Ajuda a equipe a atender primeiro o que está parando o seu dia a dia.',
  'Não consigo emitir boleto de nenhum cliente → "Alta". Um texto está escrito errado na tela → "Baixa".',
  'Marcar tudo como "Alta": quando tudo é urgente, nada é — descreva o impacto real no campo de descrição.',
  4, '/dashboard/melhorias'),
 ('chamado.titulo', 'Chamados', 'Título',
  'Um resumo curto do problema, em poucas palavras. É opcional — se deixar em branco, usamos o começo da descrição.',
  'Facilita você e a equipe reconhecerem o chamado depois, na lista de pendentes/em andamento.',
  '"Boleto não gera na tela de Receber" ou "Somar coluna de horas no Timesheet".',
  'Escrever só "erro" ou "não funciona": não ajuda a achar o chamado depois. Seja específico sobre O QUÊ e ONDE.',
  5, '/dashboard/melhorias'),
 ('chamado.descricao', 'Chamados', 'Descrição',
  'Conte o que você tentou fazer, o que aconteceu e o que esperava que acontecesse. Pode ditar por voz pelo microfone.',
  'É o campo mais importante: quanto mais detalhe (passos, valores, mensagem de erro), mais rápido a equipe reproduz e corrige.',
  '"Abri Contas a Receber, cliquei em Gerar boleto do título 1234 e apareceu uma tela branca; eu esperava o PDF do boleto."',
  'Escrever só "não funciona" sem dizer onde nem o que fez: a equipe não consegue reproduzir e o chamado volta pedindo mais informação.',
  6, '/dashboard/melhorias')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
