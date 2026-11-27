-- Hub §329 (cockpit / prontuário da obra): ajuda de campo ("?") do bloco "Últimos diários de obra".
-- Só texto novo, aditivo e idempotente (RD-97): nenhuma linha existente é alterada.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('projetos.cockpit.ultimos_diarios', '/dashboard/projetos/obras/[id]/cockpit', 'Cockpit da obra', 'Últimos diários de obra',
   'Nada a preencher: o sistema lista os diários (RDO) mais recentes registrados nesta obra.',
   'Mostra, sem sair do cockpit, o andamento recente do campo — data, resumo das atividades, efetivo e fotos do dia — com atalho para o diário completo.',
   '27/11 · Concretagem da laje — 8 no efetivo · 3 fotos.',
   'Estranhar a lista vazia: o diário só aparece depois de registrado no Diário de obra (RDO) desta obra.',
   'projetos', 916)
ON CONFLICT (chave) DO NOTHING;
