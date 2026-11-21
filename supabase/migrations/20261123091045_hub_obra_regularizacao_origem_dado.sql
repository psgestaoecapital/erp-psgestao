-- RD-98 p3 · ORIGEM DO DADO da rota de regularização do cadastro central da obra do Hub (§314):
--   /dashboard/projetos/obras/[id]/regularizacao  (tela "Regularização da obra")
--
-- Continuação da #5746 (ficha + estrutura). A #5746 deixou a /regularizacao para depois do
-- deploy-migrations da #5743 voltar verde — o que já ocorreu: as 3 funções de licença existem em
-- produção e a linha da rota já está registrada em system_screens (estado_real=parcial,
-- rpcs_chamadas NULL). Auditoria de jornada (auditor_pdca_1, 21/11) pede rpcs_chamadas para o
-- selo (pilar 3 do RD-98 — origem do dado). Tela de ENTRADA do usuário (formulário): views_consumidas
-- pode ficar vazio; rpcs_chamadas é o obrigatório.
--
-- Fontes reais (prova no banco, RD-38 — as 3 funções existem em pg_proc/public):
--   fn_obra_licenca_listar(p_obra_id uuid)
--   fn_obra_licenca_salvar(p_obra_id uuid, p_id uuid, p_tipo text, ...)
--   fn_obra_licenca_excluir(p_id uuid, p_motivo text)
--
-- Só metadado de registro da tela: NÃO toca RLS, grants, dado de cliente, nem comportamento.
-- Aditiva e idempotente (UPDATE só do rpcs_chamadas da linha, que já existe).
--
-- Prova BEGIN..ROLLBACK (leve, não varre tabela grande):
--   antes: rpcs_chamadas NULL; depois: o array abaixo; 1 linha (nenhuma criada).

UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY[
         'fn_obra_licenca_listar',
         'fn_obra_licenca_salvar',
         'fn_obra_licenca_excluir'
       ]::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/obras/[id]/regularizacao';
