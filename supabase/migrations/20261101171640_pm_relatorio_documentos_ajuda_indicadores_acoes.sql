-- RD-95 (CEO 08/10): "?" nos 3 indicadores e nas 3 ações do Relatório de Documentos (P&M) · /dashboard/pm/relatorio-documentos.
-- Os 4 filtros e a configuração de colunas já tinham "?"; faltavam os indicadores (Documentos, Valor, A faturar) e os
-- botões (Colunas, Excel, PDF). Auditor PDCA (auditor_pdca_2, nota 87) pediu "?" em filtros/colunas/indicadores.
-- Aditivo: só texto em erp_ajuda_campo (sem tabela nova, sem RLS, sem dado de cliente). Idempotente (ON CONFLICT chave).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/pm/relatorio-documentos', 'pm', 'publicado'
FROM (VALUES
 ('pm.relatorio_documentos.ind_documentos', 'Relatório de Documentos · Indicador', 'Documentos',
  'Nada a preencher: conta quantos documentos (fees + orçamentos) passam no filtro atual.',
  'Dá o tamanho da carteira comercial no recorte escolhido, base para os demais números.',
  'Filtrar "Só fee" e ver 12 mostra quantos contratos de fee existem no período.',
  'Comparar com meses diferentes sem alinhar as datas: o número é sempre do filtro aplicado agora.',
  10),
 ('pm.relatorio_documentos.ind_valor', 'Relatório de Documentos · Indicador', 'Valor',
  'Nada a preencher: soma o valor comercial dos documentos do filtro (fee mensal do contrato e valor final da proposta).',
  'Mede o volume comercial no recorte; é o valor do documento, não o realizado financeiro (esse fica no Financeiro).',
  'R$ 180.000 em "Fee e orçamento" é a soma dos fees e dos orçamentos filtrados.',
  'Ler como receita recebida: é o valor do documento comercial, não o que já foi faturado/recebido.',
  11),
 ('pm.relatorio_documentos.ind_a_faturar', 'Relatório de Documentos · Indicador', 'A faturar',
  'Nada a preencher: soma o que ainda há a faturar dos documentos do filtro.',
  'Aponta o quanto da carteira comercial ainda está por emitir, para planejar o faturamento.',
  'R$ 50.000 "a faturar" indica orçamentos aprovados cujo faturamento ainda não saiu.',
  'Confundir com inadimplência: "a faturar" é o que falta emitir, não título vencido (isso é no Financeiro).',
  12),
 ('pm.relatorio_documentos.acao_colunas', 'Relatório de Documentos · Ação', 'Colunas',
  'Clique para escolher quais colunas aparecem na tabela (até o máximo permitido); a escolha fica lembrada neste navegador.',
  'Deixa o relatório com as colunas que importam para você, sem poluir a tela nem o export.',
  'Tirar "Desconto" e deixar "Cliente", "Valor" e "A faturar" para uma visão enxuta.',
  'Esperar que valha para todos: a escolha de colunas é só deste navegador/usuário, não muda para a equipe.',
  13),
 ('pm.relatorio_documentos.acao_excel', 'Relatório de Documentos · Ação', 'Excel',
  'Clique para baixar os documentos do filtro em planilha (CSV, abre no Excel/Sheets) com as colunas escolhidas.',
  'Leva os dados para fora quando você precisa cruzar, ordenar ou montar relatório próprio.',
  'Baixar o Excel para somar o valor a faturar por cliente numa tabela dinâmica.',
  'Esperar formatação pronta: o CSV traz os dados crus; o ajuste visual é feito no Excel.',
  14),
 ('pm.relatorio_documentos.acao_pdf', 'Relatório de Documentos · Ação', 'PDF',
  'Clique para gerar um PDF do relatório (colunas escolhidas e linhas do filtro) com cabeçalho da empresa e resumo.',
  'Serve para enviar ou arquivar um retrato do relatório sem o destinatário precisar do sistema.',
  'Gerar o PDF da carteira de fees para anexar na reunião comercial.',
  'Usar a impressão do navegador: este botão gera o arquivo direto, sem travar a aba.',
  15)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;
