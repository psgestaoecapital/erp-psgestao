-- Hub §329 (cockpit / prontuário da obra): ajuda de campo ("?") do bloco "Aprovações pendentes".
-- Só texto novo, aditivo e idempotente (RD-97): nenhuma linha existente é alterada.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('projetos.cockpit.aprovacoes_pendentes', '/dashboard/projetos/obras/[id]/cockpit', 'Cockpit da obra', 'Aprovações pendentes',
   'Nada a preencher: o sistema lista as medições desta obra que ainda estão em rascunho, ou seja, aguardando aprovação.',
   'Mostra, sem sair do cockpit, o que falta aprovar na obra — a medição em rascunho, a competência e o valor — para o gestor aprovar e liberar o faturamento (ao aprovar, a medição gera a conta a receber na Gestão Empresarial).',
   'Medição nº 3 · Competência 11/2026 · R$ 42.000,00 em rascunho.',
   'Estranhar a lista vazia: a medição só aparece aqui enquanto está em rascunho; depois de aprovada sai da lista e vira conta a receber.',
   'projetos', 919)
ON CONFLICT (chave) DO NOTHING;
