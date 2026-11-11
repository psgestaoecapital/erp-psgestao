-- GE › Financiamento: RD-95 "?" nas abas Visão Geral e Cronograma (desenvolvedor_4_g).
-- As abas "Contratos" já têm ajuda; "Visão Geral" e "Cronograma" ficavam sem o "?".
-- Seed ADITIVO em erp_ajuda_campo (reference data, sem dado de cliente); ON CONFLICT não sobrescreve.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('ge.financiamento.evolucao', '/dashboard/gestao-empresarial/financiamento', 'Financiamento', 'Evolução do saldo devedor',
   'Nada a preencher: o gráfico soma o saldo devedor restante parcela a parcela (todos os contratos com cronograma).',
   'Mostra em quanto tempo a dívida cai e quando o saldo zera, somando os contratos ativos.',
   'A linha começa no saldo cheio na parcela 1 e desce até zero na última parcela.',
   'Achar que a linha reflete só um contrato: ela soma todos os cronogramas gerados.', 'gestao_empresarial', 907),
  ('ge.financiamento.cronograma', '/dashboard/gestao-empresarial/financiamento', 'Financiamento', 'Filtros do cronograma',
   'Escolha o contrato (ou Todos) e o status das parcelas: Todas, Pagas ou A vencer.',
   'Separa as parcelas por contrato e situação para conferir o que já foi pago e o que ainda vence.',
   'Contrato Sicoob + "A vencer" para ver só o que falta pagar.',
   'Deixar em "Todos os contratos" e achar que há parcelas duplicadas: são de contratos diferentes (a coluna Contrato identifica).', 'gestao_empresarial', 908),
  ('ge.financiamento.parcelas', '/dashboard/gestao-empresarial/financiamento', 'Financiamento', 'Parcelas',
   'Nada a preencher: cada linha é uma parcela com vencimento, valor, juros, amortização e saldo devedor após o pagamento.',
   'Detalha o cronograma: quanto de cada parcela é juros e quanto abate a dívida, e como o saldo cai ao longo do tempo.',
   'Parcela 12/60 vence 10/11/2026, R$ 1.000 (juros R$ 300 + amortização R$ 700), saldo após R$ 42.000.',
   'Somar as parcelas "A vencer" e achar que é o saldo de quitação: a quitação usa o saldo devedor (principal), sem os juros futuros.', 'gestao_empresarial', 909)
ON CONFLICT (chave) DO NOTHING;
