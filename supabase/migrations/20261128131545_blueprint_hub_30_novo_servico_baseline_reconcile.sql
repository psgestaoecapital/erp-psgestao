-- Reconciliação do ledger de cobertura §30 HB0 (Hub · Catálogo de serviços) — RD-38 / RD-52
--
-- Doutrina RD-38: "auditar e provar no dado, nunca supor"; o ledger não pode mentir.
-- O requisito 762cce3c da tela 30 está marcado status_baseline='ausente':
--   "CORRIGIR: clicar em 'Novo serviço' já grava um serviço em branco — só gravar ao salvar"
-- mas JÁ ESTÁ IMPLEMENTADO na tela viva (src/app/dashboard/projetos/catalogo/page.tsx):
--
--   Prova no código:
--     - L158 (comentário HB0): "clicar em 'Novo serviço' NÃO grava mais em branco — abre o
--       modal e só grava no 'Criar serviço'".
--     - abrirNovo() (L259) apenas prepara o estado e faz setNovoAberto(true); NÃO escreve no banco.
--     - A ÚNICA escrita é confirmarNovo() (L267), disparada pelo botão "Criar serviço" do modal,
--       e só depois de validar que o nome foi preenchido (L271: "Dê um nome ao serviço antes de criar.").
--     - O botão "Novo serviço" (L784) chama abrirNovo; não há INSERT no onClick.
--
-- Esta migration só corrige o ledger (status_baseline ausente -> atendido) desse requisito provado.
-- NÃO toca os demais requisitos da tela 30. Valor 'atendido' é permitido pelo CHECK
-- blueprint_tela_requisito_status_chk {ausente,parcial,atendido,travado}.
--
-- Aditiva e idempotente: guarda por status_baseline='ausente' (re-rodar não altera nada).
-- Sem RLS/policy/grant; blueprint_tela_requisito é tabela de referência interna de cobertura,
-- não é dado de cliente.

UPDATE public.blueprint_tela_requisito
   SET status_baseline = 'atendido',
       evidencia_baseline = 'Implementado: catalogo/page.tsx L158/259/267/784 — "Novo serviço" abre modal; grava só em confirmarNovo ("Criar serviço") com nome obrigatório. Reconcilia RD-38.'
 WHERE id = '762cce3c-263c-4d8f-9419-f01e748ec9f3'
   AND vertical = 'hub_projetos'
   AND tela_num = 30
   AND status_baseline = 'ausente';
