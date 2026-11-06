-- RD-95: "?" nos botões de ação do Hub Comercial (P&M) — "+ Novo lead" e "+ Nova proposta".
-- Aditiva: só insere linhas de ajuda de campo (tabela de referência global, sem dado de cliente).
-- Idempotente: ON CONFLICT (chave) DO NOTHING — re-rodar não duplica.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  (
    'pm.comercial.btn_novo_lead',
    '/dashboard/pm/comercial',
    'Comercial',
    '+ Novo lead',
    'Clique para abrir o quadro de Leads e cadastrar um novo contato/oportunidade no topo do funil.',
    'Atalho para iniciar um lead sem sair do hub: o novo contato entra na etapa inicial do funil e passa a contar no "Pipeline (em aberto)".',
    'Ex.: um cliente pediu orçamento por telefone — clique aqui e registre o lead para não perder o acompanhamento.',
    'Cadastrar o mesmo contato duas vezes (lead duplicado). Antes de criar, confira se ele já existe no quadro de Leads.',
    'pm',
    70
  ),
  (
    'pm.comercial.btn_nova_proposta',
    '/dashboard/pm/comercial',
    'Comercial',
    '+ Nova proposta',
    'Clique para abrir a tela de Propostas e montar uma nova proposta comercial para um lead/cliente.',
    'Atalho para criar uma proposta: ao ser enviada ela entra em "Propostas abertas" e, quando aprovada, melhora a "Conversão".',
    'Ex.: o lead avançou na negociação — clique aqui para gerar a proposta com os serviços e valores.',
    'Criar proposta solta, sem vincular ao lead/cliente certo. Selecione o destinatário correto para o funil refletir a realidade.',
    'pm',
    80
  )
ON CONFLICT (chave) DO NOTHING;
