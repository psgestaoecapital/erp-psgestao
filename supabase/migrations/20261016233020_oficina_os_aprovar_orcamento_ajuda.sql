-- #135 (Triches) · atendimento centralizado: botão "Aprovar orçamento" na própria Ordem de Serviço.
-- ADITIVA: só o texto do "?" (RD-95) do botão novo. Sem tabela, função ou dado de cliente
-- (o botão usa a RPC já existente fn_oficina_orcamento_registrar, a mesma da tela de Aprovação).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'oficina.os.aprovar_orcamento', 'Oficina', 'Aprovar orçamento',
  'Clique depois que o cliente aprovar o orçamento (pelo PDF enviado, WhatsApp ou telefone). Aparece só no atendimento centralizado (sem tablet), com a OS em "Recebido" ou "Aguardando aprovação".',
  'Marca como aprovados todos os itens que ainda não tinham decisão, registra a aprovação (data e quem clicou) e passa a OS para "Aprovada", sem precisar abrir a tela de Aprovação do cliente.',
  'Cliente respondeu "aprovo" no WhatsApp ao orçamento de R$ 1.250,00 → abra a OS, confira os itens e clique em "Aprovar orçamento".',
  'Aprovar antes de lançar os preços: o item sem preço entra com R$ 0,00. Se o cliente recusou algum item, use a tela de Aprovação do cliente para marcar item a item.',
  1, '/dashboard/os', 'oficina', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
