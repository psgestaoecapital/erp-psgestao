-- Hub · Cockpit da obra (/dashboard/projetos/obras/[id]/cockpit): "?" (RD-95) do atalho "Ordens de serviço".
-- Motivo (PDCA Hub 28/10): o auditor pediu "acesso direto a RDO / medição / apontamento dentro do cockpit". O cockpit
-- é a tela "o que fazer hoje" da obra, mas só levava a horas, linha do tempo, cronograma e nova viagem — faltava o
-- caminho para as Ordens de Serviço da obra, que é onde a equipe aponta horas, lança o diário (RDO) com fotos e registra
-- a quantidade executada no dia. O atalho novo abre /obras/os já filtrado nesta obra (?obra=<id>), fechando o laço
-- execução → cockpit sem copiar o leiaute de concorrente (RD-96).
-- Aditiva: só texto de ajuda novo (erp_ajuda_campo); sem dado de cliente, sem RLS. Idempotente: ON CONFLICT (chave) DO NOTHING.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_projetos', 'publicado'
FROM (VALUES
 ('projetos.cockpit.os', 'Atalhos', 'Ordens de serviço',
  'Abre as ordens de serviço desta obra: o que cada equipe vai executar, por etapa e serviço.',
  'É de onde a equipe aponta horas (viram custo de mão de obra da margem), lança o diário do dia (RDO) com clima, fotos e quantidade executada, e inicia ou conclui a tarefa em campo.',
  'Abrir a OS "fechar o forro das salas 201 a 205", iniciar, apontar 16 h e lançar o diário do dia.',
  'Confundir com a OS da oficina (placa/veículo): esta é a OS de obra, por etapa e serviço — não leva veículo nem mecânico.',
  130, '/dashboard/projetos/obras/[id]/cockpit')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
