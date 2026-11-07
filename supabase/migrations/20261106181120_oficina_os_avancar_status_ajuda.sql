-- #135 (Triches) · ajuste 21/10: atendimento centralizado — botões "Iniciar serviço" → "Finalizar" → "Entregar" na
-- própria Ordem de Serviço. ADITIVA: só o texto do "?" (RD-95) do botão novo. Sem tabela, função ou dado de cliente
-- (o botão usa as RPCs já existentes fn_os_salvar e fn_oficina_orcamento_registrar).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'oficina.os.avancar_status', 'Oficina', 'Iniciar serviço / Finalizar / Entregar',
  'Clique para levar a OS à próxima etapa: "Iniciar serviço" (vai para Em execução), "Finalizar" (vai para Pronta) e "Entregar" (vai para Entregue). Aparece só no atendimento centralizado (sem tablet).',
  'Faz a OS andar na própria tela, sem passar pelo Diagnóstico técnico nem pela Aprovação do cliente. Os itens ainda sem aprovação são aprovados junto, para entrarem no total. Quem clicou e quando fica registrado no histórico.',
  'Cliente deixou o caminhão e autorizou o serviço → lance as peças e serviços, clique em "Iniciar serviço"; ao terminar, "Finalizar"; quando o cliente retirar, "Entregar".',
  'Entregar antes de conferir os valores: depois de entregue e faturada, os itens não mudam mais (só com estorno ou cancelamento da nota). Se quiser mandar orçamento antes, use "Imprimir como orçamento" e "Aprovar orçamento".',
  1, '/dashboard/os', 'oficina', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
