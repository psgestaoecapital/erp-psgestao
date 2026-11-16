-- RD-95: "?" nos campos dos modais "Baixar título(s)" e "Alterar vencimento" da tela Contas (GE).
-- O auditor (PDCA GE, /dashboard/contas) apontou que as duas AÇÕES principais da tela — dar baixa
-- (Data do pagamento, Conta bancária, Forma) e alterar vencimento (Novo vencimento) — abriam modais
-- com campos SEM o "?" de ajuda, enquanto os KPIs, filtros e colunas já tinham. Aditiva/idempotente:
-- só insere/atualiza chaves de ajuda; nenhuma mudança em RLS/cálculo/dado de cliente.
-- Faixa desenvolvedor_4_g (segundos :45).

INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('contas.baixa_data', '/dashboard/contas', 'Contas', 'Data do pagamento',
   'Informe o dia em que o dinheiro realmente entrou (recebimento) ou saiu (pagamento) — é a data da baixa, não a do vencimento.',
   'É por essa data que o título entra no fluxo de caixa e no saldo da conta. Pagou atrasado? Use a data em que de fato pagou.',
   'Ex.: vencia dia 05 mas você pagou dia 08 — informe 08.',
   'Usar a data de vencimento em vez da data em que o dinheiro se moveu: o caixa do dia fica errado.',
   'financeiro', 30, 'publicado'),
  ('contas.baixa_conta', '/dashboard/contas', 'Contas', 'Conta bancária da baixa',
   'Escolha a conta de onde o dinheiro saiu (pagamento) ou para onde entrou (recebimento). Deixe "Sem conta específica" só quando não souber.',
   'Liga a baixa ao saldo da conta certa, para a conciliação com o extrato do banco bater. Sem a conta, o valor fica sem lastro.',
   'Ex.: pagou pelo PIX da conta Itaú PJ — selecione "Itaú PJ".',
   'Baixar sem informar a conta: o dinheiro some do saldo de cada conta e a conciliação não fecha.',
   'financeiro', 31, 'publicado'),
  ('contas.baixa_forma', '/dashboard/contas', 'Contas', 'Forma de pagamento',
   'Selecione como o valor foi pago ou recebido: Transferência, PIX, Boleto, Dinheiro ou Cartão.',
   'Registra o meio usado na movimentação — ajuda a conferir contra o extrato e a entender por onde o dinheiro circula.',
   'Ex.: recebimento caiu via PIX — selecione "PIX".',
   'Marcar "Dinheiro" quando foi PIX/transferência: confunde a conferência do caixa físico com o bancário.',
   'financeiro', 32, 'publicado'),
  ('contas.venc_novo', '/dashboard/contas', 'Contas', 'Novo vencimento',
   'Escolha a nova data de vencimento dos títulos selecionados. Use os atalhos (+7d, +15d, +30d…) para adiar a partir de hoje.',
   'Reprograma quando o título vence — reflete na previsão do fluxo de caixa e nos avisos de atraso. Só muda o vencimento, não baixa o título.',
   'Ex.: negociou com o fornecedor para pagar em 30 dias — use "+30d".',
   'Alterar o vencimento achando que quita o título: ele continua em aberto, só com a data nova.',
   'financeiro', 33, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status;
