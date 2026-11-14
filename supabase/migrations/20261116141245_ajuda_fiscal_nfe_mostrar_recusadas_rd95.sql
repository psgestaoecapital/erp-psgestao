-- RD-95: "?" no filtro "Mostrar tentativas recusadas" da tela de NF-e Emitidas (/dashboard/fiscal/nfe).
-- Gap do auditor (aud8): o checkbox "Mostrar tentativas recusadas (visão antiga)" e os campos de texto
-- dos modais (Carta de correção / Cancelar) ficavam sem "?". As ações já tinham chave
-- (fiscal.nfe.acao_carta_correcao / fiscal.nfe.acao_cancelar), reusadas no texto do modal; falta só a
-- chave do checkbox, criada aqui. Aditivo: só INSERT de texto de ajuda (ON CONFLICT (chave) DO NOTHING),
-- nunca altera dado de cliente, cálculo fiscal nem RLS. Code: desenvolvedor_4_g (faixa de segundos :45–:54).

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
  ('fiscal.nfe.mostrar_recusadas', 'Filtros', 'Mostrar tentativas recusadas',
   'Marque para incluir na lista as tentativas de emissão que a SEFAZ recusou — notas que nunca chegaram a ser autorizadas. Desmarcado (padrão), a lista mostra só as notas válidas do fluxo atual.',
   'Ajuda a auditar o que deu errado: ver as recusas antigas e seus motivos sem poluir a visão do dia a dia, que normalmente só precisa das notas autorizadas.',
   'Marcar para investigar por que uma venda não gerou nota: aparecem as tentativas recusadas com o motivo informado pela SEFAZ.',
   'Deixar marcado no dia a dia e achar que há notas "a mais": as linhas recusadas não são notas emitidas, são só tentativas que falharam.',
   6, '/dashboard/fiscal/nfe', 'fiscal', 'publicado')
ON CONFLICT (chave) DO NOTHING;
