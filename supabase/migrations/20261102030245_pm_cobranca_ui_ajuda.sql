-- RD-95 (CEO 08/10): "?" dos NOVOS elementos da tela Cobrança / Fee · /dashboard/pm/cobranca.
-- PR (2) — camada de TELA da cobrança por etapa (segue a camada de dados da #3699).
-- A tela passa a LANÇAR / AVANÇAR status / ESTORNAR a cobrança por contrato e a mostrar o
-- HISTÓRICO (agency_cobranca_lancamento). Esta migration só cadastra a ajuda (texto) dos
-- novos indicadores/ações; nenhum cálculo ou fluxo é alterado. Aditivo, idempotente (ON CONFLICT chave).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/pm/cobranca', 'pm', 'publicado'
FROM (VALUES
 ('pm.cobranca.status', 'Cobrança · Status', 'Status da cobrança do mês',
  'Mostra em que etapa está a cobrança do contrato no mês: a lançar, lançada, enviada, paga ou estornada. É um indicador, não se digita.',
  'Acompanha a jornada da cobrança por contrato sem sair da tela — do lançamento ao recebimento.',
  '"Enviada" = a cobrança do mês já foi lançada e marcada como enviada ao cliente, aguardando o pagamento.',
  'Achar que "Lançada" quer dizer paga: lançada é só o registro interno; o pagamento é a etapa "Paga".',
  5),
 ('pm.cobranca.acao_lancar', 'Cobrança · Ações', 'Lançar cobrança',
  'Registra a cobrança do fee do contrato na competência do mês (valor sugerido = fee mensal). Uma viva por contrato/mês.',
  'Persiste a cobrança para acompanhar o status e o histórico — base para depois emitir na Gestão Empresarial.',
  'Clicar em "Lançar cobrança" num contrato sem cobrança do mês cria o registro com status "Lançada".',
  'Lançar duas vezes o mesmo contrato no mês: a tela reaproveita a cobrança viva e não duplica.',
  6),
 ('pm.cobranca.acao_avancar', 'Cobrança · Ações', 'Avançar status',
  'Move a cobrança para a próxima etapa: de Lançada para Enviada, e de Enviada para Paga.',
  'Marca o andamento real da cobrança (enviada ao cliente / recebida), alimentando o histórico com data e hora.',
  'Em uma cobrança "Lançada", "Marcar enviada" passa o status para "Enviada" e grava a data de envio.',
  'Pular etapa achando que marca o caixa: "Paga" aqui registra o recebimento no acompanhamento, não baixa financeira na GE.',
  7),
 ('pm.cobranca.acao_estornar', 'Cobrança · Ações', 'Estornar cobrança',
  'Cancela a cobrança do mês de forma rastreável (pede o motivo). Não apaga: o registro fica no histórico como "Estornada".',
  'Permite corrigir uma cobrança lançada por engano mantendo o rastro de quem estornou, quando e por quê (auditoria).',
  'Estornar com o motivo "valor errado" marca a cobrança como Estornada e libera um novo lançamento no mês.',
  'Esperar que suma da lista: o estorno é soft — fica visível no histórico para prova e auditoria.',
  8),
 ('pm.cobranca.historico', 'Cobrança · Histórico', 'Histórico de cobranças',
  'Lista todas as cobranças lançadas por contrato e competência, incluindo as estornadas, da mais recente para a mais antiga.',
  'Dá a prova do que foi cobrado no tempo (status, valor, datas e motivo de estorno) para conferência e auditoria.',
  'O histórico mostra a cobrança de outubro "Paga" e a de setembro "Estornada" com o motivo.',
  'Procurar aqui a baixa financeira: o histórico é o acompanhamento da cobrança, não o extrato de caixa da GE.',
  9)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;
