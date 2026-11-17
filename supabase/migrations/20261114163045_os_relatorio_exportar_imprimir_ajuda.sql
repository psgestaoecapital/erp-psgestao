-- /dashboard/os/relatorio · Relatório de ordens de serviço — ações de saída (RD-98): exportar CSV e imprimir/PDF.
-- Esta migration é ADITIVA e idempotente: cadastra só as 2 chaves de ajuda RD-95 dos novos botões de saída
-- (recorte da própria tela, sem nova chamada ao banco). Nenhuma função, RLS, tabela ou dado de cliente é tocado —
-- apenas 2 linhas do catálogo de ajuda (erp_ajuda_campo).
--
-- Code: desenvolvedor_4_g

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  (
    'os.relatorio.exportar_csv',
    '/dashboard/os/relatorio',
    'Relatório de OS',
    'Exportar CSV',
    'Clique para baixar uma planilha (CSV) com as ordens de serviço que estão na tela — exatamente o período e os filtros que você escolheu acima.',
    'Leva o relatório para fora do sistema: o arquivo abre no Excel ou no Google Planilhas (acentos e colunas já certos, valores em reais), para você conferir, arquivar ou enviar ao cliente.',
    'Escolher "Últimos 12 meses" e clicar em "Exportar CSV" → baixa um arquivo com uma linha por ordem (número, data, cliente, placa, situação, serviços, peças e total).',
    'O arquivo traz só as ordens do período filtrado; se vier vazio ou faltar alguma, amplie o período antes de exportar. O botão só aparece quando há ordens no período.',
    'oficina',
    14,
    'publicado'
  ),
  (
    'os.relatorio.imprimir',
    '/dashboard/os/relatorio',
    'Relatório de OS',
    'Imprimir / PDF',
    'Clique para imprimir o relatório ou salvá-lo em PDF. Abre a janela de impressão do navegador — escolha a impressora ou "Salvar como PDF".',
    'Gera uma versão limpa do relatório para imprimir ou guardar em PDF (sem o menu lateral e sem os botões), pronta para anexar, arquivar ou entregar.',
    'Clicar em "Imprimir / PDF" → na janela que abre, escolher "Salvar como PDF" para ter o relatório do período em um arquivo.',
    'A impressão usa o período e os filtros da tela; ajuste as datas antes de imprimir. Sai só o relatório — os botões e o menu não aparecem na folha.',
    'oficina',
    15,
    'publicado'
  )
ON CONFLICT (chave) DO NOTHING;
