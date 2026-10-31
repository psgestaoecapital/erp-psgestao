-- RD-95 (CEO 08/10): "?" na tela Aprovação do cliente (P&M) · /dashboard/pm/aprovacao.
-- O auditor PDCA (auditor_pdca_2, 30/10) pediu fechar RD-95. A tela não tem formulário; os elementos
-- de RD-95 são o contexto da tela e as DUAS ações (Aprovar / Reprovar). Esta PR cadastra a ajuda "?" dos 3.
-- Aditivo: só texto em erp_ajuda_campo (sem tabela nova, sem RLS, sem dado de cliente). Idempotente (ON CONFLICT chave).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/pm/aprovacao', 'pm', 'publicado'
FROM (VALUES
 ('pm.aprovacao.tela', 'Aprovação · Visão geral', 'Aprovação do cliente',
  'Esta é a fila de jobs que estão em conferência (status "em aprovação") aguardando o OK. Não se preenche nada: você decide cada card com Aprovar ou Reprovar.',
  'É o portão entre a produção e a publicação: só o que o cliente aprova aqui passa a publicado; o reprovado volta para a equipe ajustar.',
  'Três jobs na fila; você aprova dois (vão a publicado) e reprova um (volta para produção com o ajuste combinado).',
  'Esperar o job aparecer aqui sozinho: ele só entra quando a produção o move para "em aprovação" lá no workspace.',
  1),
 ('pm.aprovacao.acao_aprovar', 'Aprovação · Ações', 'Aprovar',
  'Clique em Aprovar quando o cliente deu o OK no job. O status muda para "publicado" na hora e o card sai da fila.',
  'Marca o job como entregue/aprovado — é esse status que alimenta faturamento, portfólio e os indicadores de entrega.',
  'Cliente respondeu "pode publicar" → Aprovar → o job some da fila e aparece como publicado.',
  'Aprovar sem o retorno do cliente: publicar não tem desfazer de um clique — o job teria de ser reaberto na produção.',
  2),
 ('pm.aprovacao.acao_reprovar', 'Aprovação · Ações', 'Reprovar',
  'Clique em Reprovar quando o cliente pediu mudança. O job volta para "em produção" para a equipe ajustar e reenviar.',
  'Devolve o job ao fluxo de produção sem perder o histórico, para o ajuste e uma nova rodada de aprovação.',
  'Cliente pediu outra cor na arte → Reprovar → o job volta para a equipe e depois retorna para esta fila.',
  'Usar Reprovar para "cancelar" o job: reprovar só devolve para produção; cancelamento é feito no próprio job.',
  3)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;
