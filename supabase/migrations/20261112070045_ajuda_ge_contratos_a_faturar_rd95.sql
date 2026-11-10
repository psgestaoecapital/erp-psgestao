-- RD-95 (CEO 08/10): "?" nos indicadores e na ação da subtela "Contratos a Faturar" (próximos 15 dias)
-- · /dashboard/cadastros/contratos-recorrentes/a-faturar. A tela-mãe já está coberta; a subtela não tinha nenhum "?".
-- O auditor PDCA pediu fechar RD-95 em Cobranças recorrentes. Esta PR cobre os 3 itens visíveis da subtela
-- (indicador Valor, indicador Próximo vencimento e a ação Faturar agora). Sem mexer no cálculo/fluxo.
-- Aditivo: só texto em erp_ajuda_campo (sem tabela nova, sem RLS, sem dado de cliente). Idempotente (ON CONFLICT chave).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/cadastros/contratos-recorrentes/a-faturar', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('ge.contratos.a_faturar.proximo_venc', 'Cobranças recorrentes · A faturar', 'Próximo vencimento',
  'Nada a preencher — é calculado a partir do dia de vencimento (ou do último título gerado) de cada cobrança ativa.',
  'Mostra a data em que a próxima cobrança do contrato vence, para você faturar na hora certa. A lista traz só o que vence nos próximos 15 dias.',
  'Dia de vencimento 10 e hoje é dia 3 → próximo vencimento aparece como 10 deste mês.',
  'Esperar ver aqui contratos pausados ou encerrados, ou vencimentos além de 15 dias: só entram as cobranças ativas que vencem na janela.',
  1),
 ('ge.contratos.a_faturar.valor', 'Cobranças recorrentes · A faturar', 'Valor',
  'Nada a preencher — vem do valor atual da cobrança (ou do valor mensal, quando não há valor atual).',
  'Indica quanto será lançado em Contas a Receber quando você faturar esta cobrança.',
  'Mensalidade de R$ 1.000 → a conta a receber é gerada com R$ 1.000.',
  'Achar que mostra o total do contrato: é o valor de UMA cobrança (um mês), não a soma de todo o período.',
  2),
 ('ge.contratos.a_faturar.faturar', 'Cobranças recorrentes · A faturar', 'Faturar agora',
  'Clique para gerar a conta a receber desta cobrança no mês de referência; confirme no aviso que aparece.',
  'Transforma a cobrança recorrente em um título de Contas a Receber de verdade, sem precisar digitar nada à mão.',
  'Clicar em "Faturar agora →" cria a conta a receber do cliente com o valor e o vencimento mostrados.',
  'Clicar duas vezes achando que não gerou: confira em Contas a Receber antes de refazer, para não duplicar o título.',
  3)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;
