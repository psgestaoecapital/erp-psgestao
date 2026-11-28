-- Financeiro · Nova receita (/dashboard/financeiro/nova-receita) — estado_real: parcial -> pronto.
-- Recount aud8 23/11 (tarefa f9d56560), item 3: "estado_real=parcial em system_screens — subir para pronto
-- apos 1 e 2". Os dois gaps que seguravam o parcial estao fechados na MESMA PR (#5964):
--   1) Anexo/comprovante do recebimento: coluna erp_receber.anexo_path/anexo_nome + bucket privado
--      'receber-comprovantes' + UI (ComprovanteReceber.tsx / CampoComprovanteReceber no NovaReceitaForm).
--   2) Ajuda "?" (RD-95) completa: todos os 23 Campos e os AjudaCampo avulsos da tela tem chave em
--      erp_ajuda_campo (comprovante/ver_comprovante semeados nesta PR; demais ja existentes).
-- Code: code-desenvolvedor-3
--
-- ADITIVA e idempotente: so atualiza o campo de STATUS de monitoramento de UMA tela de sistema
-- (tabela de configuracao interna, nao e dado de cliente). Nao toca RLS/grants, nao altera/apaga dado de
-- cliente. O selo 'auditada_ok' NAO e tocado aqui: continua por conta do aud8 (reemite a nota a-h).
UPDATE public.system_screens
   SET estado_real = 'pronto',
       atualizado_em = now()
 WHERE rota = '/dashboard/financeiro/nova-receita'
   AND estado_real IS DISTINCT FROM 'pronto';
