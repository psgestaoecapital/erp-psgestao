-- Hub §329 (cockpit / prontuário da obra): ajuda de campo ("?") do bloco "Fornecedores da obra".
-- Só texto novo, aditivo e idempotente (RD-97): nenhuma linha existente é alterada.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('projetos.cockpit.fornecedores_obra', '/dashboard/projetos/obras/[id]/cockpit', 'Cockpit da obra', 'Fornecedores da obra',
   'Nada a preencher: o sistema reúne os fornecedores que aparecem nos custos lançados desta obra (contas a pagar ligadas ao centro de custo da obra).',
   'Mostra, sem sair do cockpit, quem são os maiores fornecedores da obra, quantos lançamentos cada um tem e quanto já foi pago — para o gestor ver a concentração de gasto por fornecedor e abrir os Custos da obra para o detalhe.',
   'Depósito Central — 4 lançamentos · R$ 18.500,00 · R$ 12.000,00 pagos.',
   'Estranhar a lista vazia: o fornecedor só aparece aqui depois que há custo lançado na obra com o nome do fornecedor preenchido; lançamentos cancelados e viagens não entram.',
   'projetos', 918)
ON CONFLICT (chave) DO NOTHING;
