-- PDCA GE · /dashboard/financeiro/conciliacao/inbox · RD-95 gap4 (auditor_pdca_2)
-- Adiciona o "?" (AjudaCampo) no filtro de natureza da aba "Pendências do Sistema" (modo = 'sistema').
-- O lado Extrato já tinha "?" (financeiro.conciliacao.filtro_natureza); o lado Sistema não.
-- Aditiva e idempotente: só INSERE a chave nova se ainda não existir. Catálogo de ajuda = dado de referência global.
-- Code: code-desenvolvedor-3
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT
  'financeiro.conciliacao.filtro_natureza_sistema',
  '/dashboard/financeiro/conciliacao/inbox',
  'Conciliação',
  'Filtro por natureza — Pendências do Sistema (A pagar / A receber)',
  'Na aba "Pendências do Sistema", filtre os títulos ainda não conciliados por Todos, A pagar (saídas) ou A receber (entradas).',
  'Permite tratar primeiro um tipo de título — por exemplo, conferir todos os recebimentos do sistema sem baixa no extrato antes dos pagamentos.',
  'Clicar em "A receber" para ver só os títulos de entrada que o sistema registrou mas que ainda não apareceram conciliados no extrato.',
  'Deixar o filtro em "A pagar" e concluir que não há recebimentos pendentes no sistema.',
  'financeiro',
  13,
  'publicado'
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_ajuda_campo WHERE chave = 'financeiro.conciliacao.filtro_natureza_sistema'
);
