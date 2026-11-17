-- RD-95 + RD-98 p2: "?" na AÇÃO de inativar/reativar o PRESTADOR na ficha de detalhe
-- (/dashboard/ehs/prestadores/[id]). A auditoria (aud8, 17/11) apontou que não havia
-- como EXCLUIR/INATIVAR o prestador em si (só incluir, editar e ações de documento).
-- A ficha passa a ter "Inativar prestador" (soft-delete rastreável: quem + motivo + audit_log)
-- e "Reativar prestador". Esta migration é ADITIVA e idempotente: só insere as 3 chaves novas
-- de ajuda em erp_ajuda_campo (ON CONFLICT (chave) DO NOTHING), sem tocar dado de cliente.
-- Faixa de segundos do agente desenvolvedor_4_g (45–54): timestamp :45.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, status)
VALUES
  (
    'compliance.prestadores.inativar',
    '/dashboard/ehs/prestadores',
    'Prestadores',
    'compliance',
    'Inativar prestador',
    'Clique para inativar o prestador quando o contrato encerrar ou ele deixar de atuar. Informe o motivo no campo que abre.',
    'Faz uma exclusão reversível (soft-delete): o prestador sai da lista de ativos, mas o histórico de documentos e o motivo da inativação ficam guardados com quem fez e quando (rastreável).',
    'Inativar a empresa de limpeza cujo contrato terminou em dezembro.',
    'Usar para corrigir um cadastro errado: nesse caso edite os dados na ficha; inative só quem realmente deixou de prestar serviço.',
    12,
    'publicado'
  ),
  (
    'compliance.prestadores.inativar_motivo',
    '/dashboard/ehs/prestadores',
    'Prestadores',
    'compliance',
    'Motivo da inativação',
    'Descreva por que o prestador está sendo inativado (fim de contrato, troca de fornecedor, encerramento da empresa etc.).',
    'O motivo fica no registro de auditoria junto com o seu usuário e a data, para quem revisar depois entender a decisão.',
    'Contrato encerrado em 31/12/2026, não renovado.',
    'Deixar em branco: o motivo é obrigatório para manter o histórico rastreável.',
    13,
    'publicado'
  ),
  (
    'compliance.prestadores.reativar',
    '/dashboard/ehs/prestadores',
    'Prestadores',
    'compliance',
    'Reativar prestador',
    'Clique para reativar um prestador que havia sido inativado e voltou a prestar serviço.',
    'Traz o prestador de volta para a lista de ativos, com todo o histórico de documentos preservado.',
    'Reativar a transportadora que foi recontratada neste trimestre.',
    'Recadastrar do zero um prestador que já existe inativo: reative o registro antigo para não duplicar o CNPJ.',
    14,
    'publicado'
  )
ON CONFLICT (chave) DO NOTHING;
