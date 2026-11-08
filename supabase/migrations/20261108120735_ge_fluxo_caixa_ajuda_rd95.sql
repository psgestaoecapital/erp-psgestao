-- Gestão Empresarial · Fluxo de Caixa (/dashboard/financeiro/fluxo-caixa · fn_fluxo_caixa_diario)
-- Jornada auditada (pdca_2, DEMO GE): o CÁLCULO BATE (fn_fluxo_caixa_diario). Faltava polimento:
--  1) RD-95: 0 "?" na tela. "?" (AjudaCampo) no seletor de período, nos 3 KPIs (Saldo Atual/Entradas/Saídas) e nas 7
--     colunas (Data, Entradas, Saídas, Transf. ↓, Transf. ↑, Movimento, Saldo no dia) — 11 chaves novas aqui.
--  2) RD-98 estado vazio: a tela ganhou CTA "Lançar receita/despesa" (no .tsx) apontando para nova-receita/nova-despesa.
--  3) RD-98 p3: origem do dado (fn_fluxo_caixa_diario) em system_screens.rpcs_chamadas.
--
-- ADITIVA (RD-94.1-c): só texto de ajuda novo + metadados da própria tela; NÃO altera tabela/função nem dado de cliente.
-- Idempotente (ON CONFLICT DO NOTHING). Versão acima da main, faixa de segundos do code-desenvolvedor-3 (:35).

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/financeiro/fluxo-caixa', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('ge.fluxo_caixa.periodo', 'Filtros', 'Período',
  'Escolha a janela de dias (7, 30 ou 90) em torno de hoje que o fluxo mostra — tanto para trás quanto para frente.',
  'Define quanto do passado e do futuro próximo você vê no gráfico e na lista de movimentações.',
  'Escolha 30 dias para ver o mês ao redor de hoje.',
  'Achar que mostra só o passado: a janela também projeta os dias à frente (vencimentos a receber/pagar).', 1),
 ('ge.fluxo_caixa.kpi.saldo_atual', 'Indicadores', 'Saldo Atual',
  'Nada a preencher: é o saldo projetado para o dia de hoje somando todas as contas.',
  'Mostra quanto você tem disponível hoje, considerando o que já entrou e saiu.',
  'Se o saldo de hoje é R$ 15.800,00, é esse o valor.',
  'Confundir com saldo bancário fechado: aqui é a visão do fluxo (entradas e saídas registradas), não o extrato do banco.', 2),
 ('ge.fluxo_caixa.kpi.entradas', 'Indicadores', 'Entradas no período',
  'Nada a preencher: é a soma de tudo que entra (recebimentos) dentro da janela escolhida.',
  'Mostra o total que entra no caixa no período — a força do seu faturamento no intervalo.',
  'Se entram R$ 300,00 no período, é esse o valor.',
  'Somar transferências entre contas próprias: elas entram em "Transf.", não como entrada de caixa.', 3),
 ('ge.fluxo_caixa.kpi.saidas', 'Indicadores', 'Saídas no período',
  'Nada a preencher: é a soma de tudo que sai (pagamentos) dentro da janela escolhida.',
  'Mostra o total que sai do caixa no período — o peso das contas a pagar no intervalo.',
  'Se saem R$ 0,00 no período, o indicador mostra R$ 0,00.',
  'Contar transferências entre contas próprias como saída: elas aparecem em "Transf.", não como saída de caixa.', 4),
 ('ge.fluxo_caixa.col.data', 'Colunas', 'Data',
  'Nada a preencher: é o dia do fluxo. O dia de hoje aparece destacado e marcado "(hoje)".',
  'Posiciona cada linha no tempo — passado à esquerda, futuro à direita de hoje.',
  '08/11.',
  'Procurar um lançamento específico: esta tela resume por DIA; o detalhe de cada título fica no Extrato.', 5),
 ('ge.fluxo_caixa.col.entradas', 'Colunas', 'Entradas',
  'Nada a preencher: é o total recebido naquele dia.',
  'Mostra quanto entrou no caixa no dia.',
  '+R$ 300,00 num dia com um recebimento; "—" num dia sem entradas.',
  'Ler "—" como erro: significa que não houve entrada naquele dia.', 6),
 ('ge.fluxo_caixa.col.saidas', 'Colunas', 'Saídas',
  'Nada a preencher: é o total pago naquele dia.',
  'Mostra quanto saiu do caixa no dia.',
  '−R$ 120,00 num dia com um pagamento; "—" num dia sem saídas.',
  'Somar com as transferências: saídas são pagamentos a terceiros, não movimentação entre contas próprias.', 7),
 ('ge.fluxo_caixa.col.transf_entrada', 'Colunas', 'Transf. ↓ (entrada)',
  'Nada a preencher: é o valor que entrou naquele dia vindo de outra conta sua (transferência interna).',
  'Separa movimentação entre contas próprias do caixa de verdade — por isso não conta como entrada.',
  '+R$ 1.000,00 ao transferir da poupança para a conta corrente.',
  'Contar como faturamento: transferência entre contas próprias não é receita.', 8),
 ('ge.fluxo_caixa.col.transf_saida', 'Colunas', 'Transf. ↑ (saída)',
  'Nada a preencher: é o valor que saiu naquele dia para outra conta sua (transferência interna).',
  'Separa movimentação entre contas próprias do caixa de verdade — por isso não conta como saída.',
  '−R$ 1.000,00 ao transferir da conta corrente para a poupança.',
  'Contar como despesa: transferência entre contas próprias não é gasto.', 9),
 ('ge.fluxo_caixa.col.movimento', 'Colunas', 'Movimento',
  'Nada a preencher: é o resultado do dia = entradas − saídas (as transferências internas se anulam no total).',
  'Mostra se o dia foi positivo (entrou mais do que saiu) ou negativo.',
  '+R$ 180,00 num dia com R$ 300,00 de entrada e R$ 120,00 de saída.',
  'Confundir com o saldo: movimento é só do DIA; o saldo acumula dia após dia.', 10),
 ('ge.fluxo_caixa.col.saldo', 'Colunas', 'Saldo no dia',
  'Nada a preencher: é o saldo acumulado ao fim daquele dia (saldo do dia anterior + movimento do dia).',
  'Permite ver se e quando o caixa fica negativo — o principal alerta do fluxo.',
  'Se o saldo de ontem era R$ 15.620,00 e hoje o movimento foi +R$ 180,00, o saldo de hoje é R$ 15.800,00.',
  'Ler o saldo de um dia futuro como garantido: ele depende de os recebimentos previstos de fato entrarem.', 11)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- RD-98 p3: origem do dado da tela.
UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY['fn_fluxo_caixa_diario','fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[]
 WHERE rota = '/dashboard/financeiro/fluxo-caixa';
