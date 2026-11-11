-- RD-98 p3 (origem do dado) · /dashboard/financeiro/conciliacao
-- Gap do auditor (aud8 10/11): system_screens.views_consumidas E rpcs_chamadas VAZIOS (0/0)
-- para a rota /dashboard/financeiro/conciliacao, apesar de a tela mostrar dado real.
--
-- A rota /dashboard/financeiro/conciliacao é um REDIRECT para o inbox canônico
-- (/dashboard/financeiro/conciliacao/inbox), onde a provenência já está registrada.
-- Espelhamos a origem do dado do inbox para a rota-pai, documentando o que a tela
-- efetivamente consome quando o usuário é redirecionado.
--
-- Aditiva/idempotente: só preenche a partir do inbox e só grava se houver diferença.
-- Não toca dado de cliente. RD-38: ver contagem antes/depois no corpo da PR.

UPDATE system_screens AS alvo
SET views_consumidas = canon.views_consumidas,
    rpcs_chamadas    = canon.rpcs_chamadas
FROM system_screens AS canon
WHERE canon.rota = '/dashboard/financeiro/conciliacao/inbox'
  AND alvo.rota  = '/dashboard/financeiro/conciliacao'
  AND (
    alvo.views_consumidas IS DISTINCT FROM canon.views_consumidas
    OR alvo.rpcs_chamadas IS DISTINCT FROM canon.rpcs_chamadas
  );
