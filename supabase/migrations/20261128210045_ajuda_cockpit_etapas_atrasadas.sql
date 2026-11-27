-- Hub §329 (cockpit / prontuário da obra): ajuda de campo ("?") do bloco "Etapas atrasadas".
-- Só texto novo, aditivo e idempotente (RD-97): nenhuma linha existente é alterada.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('projetos.cockpit.etapas_atrasadas', '/dashboard/projetos/obras/[id]/cockpit', 'Cockpit da obra', 'Etapas atrasadas',
   'Nada a preencher: o sistema lista as etapas do cronograma cujo prazo já passou e que ainda não foram concluídas.',
   'Mostra, sem sair do cockpit, o que está em atraso na obra — a etapa, o quanto já foi concluído e há quantos dias passou do prazo — para o gestor priorizar ou replanejar o cronograma.',
   'Pintura e entrega — 10% concluído · 30 dias de atraso.',
   'Estranhar a lista vazia: a etapa só aparece como atrasada depois que a data de fim no cronograma fica no passado e o percentual segue abaixo de 100%.',
   'projetos', 917)
ON CONFLICT (chave) DO NOTHING;
