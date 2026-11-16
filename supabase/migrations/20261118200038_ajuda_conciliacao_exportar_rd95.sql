-- PDCA GE · /dashboard/financeiro/conciliacao/inbox · RD-95 gap2 (auditor_pdca_2)
-- Adiciona o "?" (AjudaCampo) da nova ação "Exportar" (Excel/PDF) da conciliação bancária.
-- Aditiva e idempotente: só INSERE a chave nova se ainda não existir. Catálogo de ajuda = dado de referência global.
-- Code: code-desenvolvedor-3
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT
  'financeiro.conciliacao.exportar',
  '/dashboard/financeiro/conciliacao/inbox',
  'Conciliação',
  'Exportar (Excel / PDF)',
  'Ação (não se preenche): baixa a lista da aba aberta (Pendentes do extrato, Pendências do sistema, Conciliados ou Ignorados) do lote selecionado, em Excel (.xlsx) ou PDF, com empresa, período e totais no cabeçalho.',
  'Serve para conferir, arquivar ou enviar o relatório da conciliação fora do sistema — por exemplo para a contabilidade — sem redigitar nada.',
  'Abrir a aba "Conciliados", clicar em "Exportar" › "Excel" e anexar o arquivo no fechamento do mês.',
  'Esperar que exporte tudo de uma vez: exporta a aba que está aberta — troque de aba para exportar as outras listas.',
  'financeiro',
  16,
  'publicado'
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_ajuda_campo WHERE chave = 'financeiro.conciliacao.exportar'
);
