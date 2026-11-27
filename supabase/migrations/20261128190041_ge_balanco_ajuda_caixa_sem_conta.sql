-- RD-95: chave de ajuda "?" para a nota de conciliação de caixa na tela Balanço Patrimonial.
-- A tela passa a explicar a diferença entre "Caixa e bancos" (só contas) e o Caixa do Grupo
-- (que soma também lançamentos pagos sem conta vinculada) — auditor_pdca_2 27/11, critério c/e.
-- Aditivo, idempotente, sem tocar dado de cliente.
-- Code: code-desenvolvedor-3

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES (
  'ge.balanco.caixa_sem_conta',
  '/dashboard/gestao-empresarial/balanco-patrimonial',
  'Linhas',
  'Lançamentos sem conta bancária',
  'Nada a preencher aqui: é um aviso. Mostra quanto dinheiro já foi pago/recebido sem uma conta bancária vinculada ao lançamento.',
  'Explica por que o "Caixa e bancos" do Balanço (que soma só as contas bancárias) pode diferir do saldo da tela Caixa do Grupo (que soma também os lançamentos pagos sem conta). "Caixa e bancos" + "sem conta" = Caixa do Grupo.',
  'Pagamento de pró-labore baixado sem escolher a conta: aparece no Caixa do Grupo, mas não no saldo de bancos do Balanço até você atribuir uma conta.',
  'Achar que o Balanço está errado por não bater com o Caixa do Grupo. Não está: são visões diferentes do mesmo caixa. Para conciliar, atribua uma conta bancária a esses lançamentos.',
  'gestao_empresarial',
  900,
  'publicado'
)
ON CONFLICT (chave) DO NOTHING;
