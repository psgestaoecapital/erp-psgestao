-- RD-95: "?" no marcador de títulos do conciliador (tela Conciliação › Inbox, GE).
-- O auditor (PDCA GE, /dashboard/financeiro/conciliacao/inbox) apontou que a lista "Marque os
-- títulos deste débito" (onde se escolhe quais lançamentos batem com o movimento do extrato)
-- abria SEM o "?" de ajuda. Os campos de importar OFX (conta e arquivo) já têm chave e o "?" é
-- apenas marcado no wrapper (data-ajuda) para o gate reconhecê-lo. Aditiva/idempotente: só
-- insere/atualiza chave de ajuda; nenhuma mudança em RLS/cálculo/dado de cliente.
-- Faixa desenvolvedor_4_g (segundos :45).

INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('financeiro.conciliacao.match_titulo', '/dashboard/financeiro/conciliacao/inbox', 'Conciliar', 'Marcar título do débito',
   'Marque o(s) título(s) do sistema que correspondem a este movimento do extrato. O total selecionado precisa bater com o valor do débito (aparece "✓ bate" quando fecha).',
   'É assim que você diz ao sistema qual conta a pagar/receber aquele movimento do banco quitou — sem marcar, o movimento fica sem conciliar e o saldo não fecha.',
   'Ex.: débito de R$ 1.200 no extrato = marcar o boleto do fornecedor de R$ 1.200 ("✓ bate").',
   'Marcar títulos cuja soma não bate com o débito: o sistema não deixa conciliar enquanto não fechar o valor.',
   'financeiro', 30, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status;
