-- fix(hub/§30 HB0 · RD-38): reconcilia baseline do "Novo serviço" do Catálogo (já corrigido no código)
--
-- O requisito HB0 item 5 "clicar em 'Novo serviço' já grava um serviço em branco — só gravar ao salvar"
-- já está ATENDIDO no código vivo (src/app/dashboard/projetos/catalogo/page.tsx):
--   • o botão "Novo serviço" chama abrirNovo() → só ABRE o modal (setNovoAberto(true)), não grava nada;
--   • a gravação (supabase.from('projetos_servicos').insert(...)) acontece apenas em criarServico(),
--     que ainda exige nome ("Dê um nome ao serviço antes de criar." → return) antes de inserir.
-- Comentário-âncora no código: "HB0 item 5 (CEO): clicar em 'Novo serviço' NÃO grava mais em branco".
--
-- Esta migration só corrige o status_baseline (de 'ausente' → 'atendido') desse requisito no blueprint vivo,
-- sem tocar código, dado de cliente, RLS, grants ou funções. Aditiva e idempotente (guard por status atual).

UPDATE public.blueprint_tela_requisito
   SET status_baseline   = 'atendido',
       evidencia_baseline = 'código vivo · src/app/dashboard/projetos/catalogo/page.tsx · botão "Novo serviço"=abrirNovo() (só abre modal); insert só em criarServico() com nome obrigatório'
 WHERE id = '762cce3c-263c-4d8f-9419-f01e748ec9f3'
   AND status_baseline = 'ausente';

-- HB0 item: "o item 'Acompanhamento' abre a mesma tela de 'Resultado por obra' — sem tela duplicada".
-- Resolvido por DIFERENCIAÇÃO (não há mais duplicata): hoje são duas telas distintas e vivas:
--   • /dashboard/projetos/acompanhamento (src/app/dashboard/projetos/acompanhamento/page.tsx):
--     lente de ANDAMENTO — avanço físico, cronograma (em dia/atrasada), próxima entrega, última
--     medição; fonte fn_obras_acompanhamento (chamado #3742).
--   • /dashboard/projetos/obras/resultado (src/app/dashboard/projetos/obras/resultado/page.tsx):
--     lente FINANCEIRA — orçado × realizado × saldo por obra.
-- Como as telas têm propósito e fonte de dados diferentes, não há mais tela duplicada.
UPDATE public.blueprint_tela_requisito
   SET status_baseline   = 'atendido',
       evidencia_baseline = 'código vivo · acompanhamento (andamento/cronograma, fn_obras_acompanhamento) e obras/resultado (financeiro) são telas distintas — sem duplicata'
 WHERE id = '91be5afa-3171-475e-b95f-ea0c00ddf940'
   AND status_baseline = 'ausente';
