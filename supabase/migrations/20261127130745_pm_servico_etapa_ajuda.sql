-- P&M · tela 5 (Catálogo de Serviços) · P5.1 — ajuda "?" (RD-95) do gerenciador
-- de etapas-modelo por serviço (modal "Etapas · <serviço>"). Go-live piloto (CEO 25/11).
-- Aditiva e idempotente: só insere chaves novas em erp_ajuda_campo (ON CONFLICT DO NOTHING).

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'pm', 'publicado'
FROM (VALUES
 ('pm.servico.etapas', 'Serviço', 'Etapas do serviço',
  'As etapas-modelo que todo job deste serviço vai herdar. Adicione na ordem em que o trabalho acontece.',
  'O job nasce já com estas etapas, sem redigitar. É a base do tempo medido por etapa (sem clique).',
  'Briefing · Criação · Revisão interna · Aprovação do cliente · Publicação.',
  'Deixar o serviço sem etapas: o job nasce vazio e ninguém sabe em que fase o trabalho está.',
  20, '/dashboard/pm/servicos'),
 ('pm.servico.etapa_nome', 'Serviço', 'Etapa',
  'O nome da etapa do trabalho (uma fase do job).',
  'Cada etapa tem situação própria e, quando medida, registra sozinha quanto tempo o job ficou nela.',
  'Criação.',
  'Nomes vagos como "fase 1": na produção ninguém entende o que precisa ser feito.',
  21, '/dashboard/pm/servicos'),
 ('pm.servico.etapa_medir', 'Serviço', 'Medir tempo',
  'Ligue para o sistema medir sozinho o tempo de calendário desta etapa (de quando ela começa até terminar).',
  'As etapas medidas alimentam a margem, a produtividade e o preço — sem a pessoa cronometrar nada.',
  'Criação e Revisão: Sim. Aprovação do cliente (espera externa): Não.',
  'Medir uma etapa que é só espera do cliente infla o custo do job com tempo que não é trabalho.',
  22, '/dashboard/pm/servicos'),
 ('pm.servico.etapa_excluir', 'Serviço', 'Excluir etapa',
  'Remove esta etapa-modelo do serviço.',
  'Só afeta os próximos jobs; jobs já criados mantêm as etapas que já tinham.',
  'Tirar "Revisão externa" de um serviço que não usa mais essa fase.',
  'Excluir uma etapa que ainda faz parte do fluxo: os próximos jobs nascem sem ela.',
  23, '/dashboard/pm/servicos'),
 ('pm.servico.etapa_nova', 'Serviço', 'Nova etapa',
  'Digite o nome da etapa e clique em Add (ou Enter) para incluí-la no fim da lista.',
  'Monta o modelo de etapas do serviço, uma fase de cada vez.',
  'Publicação.',
  'Esquecer de marcar "Medir tempo" quando a etapa é de trabalho real.',
  24, '/dashboard/pm/servicos')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
