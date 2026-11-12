-- RD-95: "?" do card "Para tratar hoje" (P2/CEO 12/11) no Caixa do grupo.
-- Aditiva/idempotente: só insere a chave de ajuda do novo card. Nenhuma mudança em RLS/cálculo/dado.
-- Faixa jordana-code (segundos :20).

INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('ge.caixa.para_tratar_hoje', '/dashboard/financeiro/caixa-grupo', 'Caixa do grupo', 'Para tratar hoje',
   'Esta lista não se preenche — ela mostra o que o financeiro precisa resolver hoje, calculado na hora a partir das contas e títulos das empresas do grupo.',
   'Junta num lugar só as pendências do dia (diferença entre o sistema e o banco, extrato atrasado, lançamento sem conta, caixa negativo, a receber e a pagar vencendo ou em atraso) e leva você direto à tela certa pelo botão "Resolver". Vermelho = urgente; amarelo = atenção.',
   'Ex.: "A pagar em atraso — regularizar · R$ 4.040,24" com o botão Resolver abrindo o Contas a pagar já filtrado.',
   'Ignorar as linhas vermelhas: são diferenças ou atrasos que afetam o saldo e o caixa do dia.',
   'gestao_empresarial', 5, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status;
