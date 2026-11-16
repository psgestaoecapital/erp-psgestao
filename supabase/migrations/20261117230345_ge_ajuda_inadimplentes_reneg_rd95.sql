-- RD-95: "?" nos campos de seleção e no modal "Renegociar" da tela Inadimplentes (GE).
-- O auditor (PDCA GE, /dashboard/financeiro/inadimplentes) apontou que a caixa de seleção
-- (selecionar todas / selecionar conta) e os campos do modal de renegociação (nova data de
-- vencimento, novo valor total, observação) abriam SEM o "?" de ajuda, enquanto indicadores,
-- abas e ação já tinham. Aditiva/idempotente: só insere/atualiza chaves de ajuda; nenhuma
-- mudança em RLS/cálculo/dado de cliente.
-- Faixa desenvolvedor_4_g (segundos :45).

INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('ge.inadimplentes.selecionar', '/dashboard/financeiro/inadimplentes', 'Ações', 'Selecionar contas',
   'Marque a caixa de uma conta (ou "Selecionar todas") para escolher quais títulos em atraso você quer tratar em lote.',
   'Define sobre quais contas a ação de renegociar vai valer. Sem marcar nenhuma, não há o que renegociar.',
   'Ex.: marcar as 3 contas do mesmo cliente para renegociar todas de uma vez.',
   'Esquecer de marcar e clicar em renegociar: nada acontece porque nenhuma conta foi selecionada.',
   'gestao_empresarial', 7, 'publicado'),
  ('ge.inadimplentes.reneg_data', '/dashboard/financeiro/inadimplentes', 'Ações', 'Nova data de vencimento',
   'Informe a nova data combinada com o cliente para o pagamento das contas selecionadas.',
   'Reprograma o vencimento dos títulos em atraso e os marca como "em renegociação", refletindo na previsão de recebimento.',
   'Ex.: cliente prometeu pagar dia 20 — informe 20.',
   'Colocar uma data já vencida: a conta continua aparecendo como atrasada.',
   'gestao_empresarial', 8, 'publicado'),
  ('ge.inadimplentes.reneg_valor', '/dashboard/financeiro/inadimplentes', 'Ações', 'Novo valor total (opcional)',
   'Preencha só se o valor mudou na negociação (desconto, juros ou acordo). Deixe vazio para manter o valor atual.',
   'Permite registrar o valor renegociado sem refazer o título. Vazio mantém o valor original.',
   'Ex.: dívida de R$ 1.000 com R$ 100 de desconto — informe 900.',
   'Digitar o valor da parcela quando o campo é o total: o saldo do título fica errado.',
   'gestao_empresarial', 9, 'publicado'),
  ('ge.inadimplentes.reneg_obs', '/dashboard/financeiro/inadimplentes', 'Ações', 'Observação da renegociação',
   'Escreva o que foi combinado (quem negociou, condição, promessa de pagamento). Fica guardado no histórico do título.',
   'Deixa registrado o acordo para consulta e cobrança futura — quem abrir a conta depois entende o que foi tratado.',
   'Ex.: "Cliente ligou 15/11, paga 50% dia 20 e o restante dia 30".',
   'Deixar em branco: sem registro, o acordo se perde e a cobrança recomeça do zero.',
   'gestao_empresarial', 10, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status;
