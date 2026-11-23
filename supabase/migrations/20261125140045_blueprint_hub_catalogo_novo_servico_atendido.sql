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
