-- HB0 · "fotografia de 09/10" · tela 30 (Hub de Projetos)
-- RD-38: reconcilia o baseline do item "clicar em 'Novo serviço' já grava um serviço
-- em branco — só gravar ao salvar", que JÁ ESTÁ ATENDIDO no código atual.
--
-- Prova (leitura do código, src/app/dashboard/projetos/catalogo/page.tsx, 25/11/2026):
--   * abrirNovo() apenas abre o modal (setNovoAberto(true)); NÃO faz INSERT.
--   * O único INSERT em projetos_servicos acontece em confirmarNovo(), disparado
--     pelo botão "Criar serviço", e só com nome obrigatório (bloqueia nome vazio).
-- Logo, não existe mais serviço em branco criado no clique de "Novo serviço".
--
-- Aditiva e idempotente: só muda o status/evidência da linha ainda marcada 'ausente'.
UPDATE public.blueprint_tela_requisito
   SET status_baseline  = 'atendido',
       evidencia_baseline = 'ATENDIDO · /dashboard/projetos/catalogo · abrirNovo() só abre o modal; INSERT em projetos_servicos apenas em confirmarNovo() (botão "Criar serviço") com nome obrigatório — RD-38, leitura do código 25/11/2026'
 WHERE id = '762cce3c-263c-4d8f-9419-f01e748ec9f3'
   AND vertical = 'hub_projetos'
   AND status_baseline = 'ausente';
