-- P&M · Planejamento de conteúdo (/dashboard/pm/planejamento)
-- RD-95 ("?" em TODA ação): os campos e filtros já têm ajuda (9 chaves), mas as AÇÕES do painel de
-- Posts não — "Gerar jobs dos prontos" (lote), "Gerar job" (por post) e a mudança de situação
-- (não iniciada → em aprovação → publicado) não eram óbvias. Cadastra as 3 chaves de ajuda das ações.
--
-- ADITIVA (RD-94.1-c): só texto de ajuda novo (erp_ajuda_campo), rota /dashboard/pm/planejamento
-- (mesma das chaves pm.planejamento.* já existentes). NÃO altera tabela/função nem dado de cliente.
-- Idempotente (ON CONFLICT (chave) DO NOTHING). Versão acima da main, faixa de segundos :45–:54.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/pm/planejamento', 'pm', 'publicado'
FROM (VALUES
 ('pm.planejamento.acao_gerar_prontos', 'Posts · Ações', 'Gerar jobs dos prontos',
  'Nada a preencher: é um botão em lote. Clicando, todos os posts que já estão aprovados e ainda não viraram trabalho criam o job correspondente na Pauta de uma vez.',
  'Poupa repetir "Gerar job" post a post quando a aprovação do mês já saiu: um clique leva tudo o que está pronto para a execução.',
  'Fechou a aprovação de 8 posts do mês? Em vez de gerar 8 jobs à mão, clique aqui e os 8 entram na Pauta juntos.',
  'Esperar que ele gere job de post ainda em rascunho ou em aprovação: só entram os que já estão prontos e sem job.', 20),
 ('pm.planejamento.acao_gerar_job', 'Posts · Ações', 'Gerar job',
  'Nada a preencher: cria, só para aquele post, o trabalho (job) correspondente na Pauta, com prazo e peça.',
  'Transforma a ideia planejada em tarefa de produção para a equipe executar e acompanhar na Pauta.',
  'O post "Promo de Natal" está aprovado → "Gerar job" abre o job dele na Pauta, pronto para produzir.',
  'Gerar job duas vezes para o mesmo post: depois de criado, o botão some e o post passa a mostrar o link do job.', 21),
 ('pm.planejamento.acao_mudar_status', 'Posts · Ações', 'Mudar a situação do post',
  'Nada a preencher: os botões movem o post pelas etapas — Enviar para aprovação (não iniciada → em aprovação), Publicado (concluída → publicado) e Não iniciada (volta da aprovação).',
  'Mantém a situação do post sempre atual, para todo mundo ver em que etapa cada peça está sem perguntar.',
  'Terminou o conteúdo e quer o aval do cliente? "Enviar para aprovação". Saiu no ar? "Publicado".',
  'Pular etapa ou marcar "Publicado" antes de o post sair de fato: a situação deixa de refletir a realidade.', 22)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
