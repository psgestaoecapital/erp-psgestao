-- RD-98 p3 · ORIGEM DO DADO das rotas do cadastro central da obra do Hub (§314):
--   /dashboard/projetos/obras/[id]/ficha      (tela "Ficha da obra")
--   /dashboard/projetos/obras/[id]/estrutura  (tela "Estrutura da obra")
--
-- Auditoria de jornada (auditor_pdca_1, 21/11): as duas telas já leem/gravam dado real por
-- RPCs guardadas e passam a-g, mas system_screens.rpcs_chamadas está NULL nas duas rotas, o que
-- bloqueia o selo (pilar 3 do RD-98 — origem do dado). Estas são telas de ENTRADA do usuário
-- (formulário), então views_consumidas pode ficar vazio; rpcs_chamadas é o obrigatório.
--
-- Fontes reais (prova no banco, RD-38 — as 6 funções existem em pg_proc/public):
--   /ficha      → fn_obra_ficha_ler, fn_obra_ficha_salvar, fn_obra_ficha_identidade_salvar
--   /estrutura  → fn_obra_estrutura_listar, fn_obra_estrutura_salvar, fn_obra_estrutura_excluir
--
-- Só metadado de registro da tela: NÃO toca RLS, grants, dado de cliente, nem comportamento.
-- Aditiva e idempotente (UPDATE só do rpcs_chamadas das 2 linhas, que já existem). A rota
-- /regularizacao fica para depois do deploy-migrations da #5743 voltar verde (a linha dela ainda
-- não existe em system_screens), conforme o plano do auditor.
--
-- Prova BEGIN..ROLLBACK (leve, não varre tabela grande):
--   SELECT rota, rpcs_chamadas FROM public.system_screens
--    WHERE rota IN ('/dashboard/projetos/obras/[id]/ficha','/dashboard/projetos/obras/[id]/estrutura');
--   -> antes: ambas NULL; depois: os arrays abaixo; mesma contagem de linhas (nenhuma criada).

UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY[
         'fn_obra_ficha_ler',
         'fn_obra_ficha_salvar',
         'fn_obra_ficha_identidade_salvar'
       ]::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/obras/[id]/ficha';

UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY[
         'fn_obra_estrutura_listar',
         'fn_obra_estrutura_salvar',
         'fn_obra_estrutura_excluir'
       ]::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/obras/[id]/estrutura';
