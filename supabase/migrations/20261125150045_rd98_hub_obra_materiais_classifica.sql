-- fix(hub/obras/materiais · RD-98 p3): classifica estado_real da tela, que seguia NULO
--
-- RD-98 p3 "origem do dado": a tela /dashboard/projetos/obras/[id]/materiais JÁ tem a origem
-- registrada (views_consumidas=3, rpcs_chamadas=3), mas o campo estado_real ficou NULO — ou seja,
-- a tela segue "não classificada" no ledger de telas, diferente de TODAS as suas irmãs de subtela
-- de obra (cockpit, cronograma, custos, medicoes, orcamento, rdo, ... = 'parcial').
--
-- PROVA (RD-38, sem supor):
--   - A tela existe e renderiza: src/app/dashboard/projetos/obras/[id]/materiais/page.tsx (219 linhas,
--     KPIs, requisição de materiais, tabela de requisições, 16 "?" AjudaCampo — RD-95).
--   - system_screens da rota já tem views_consumidas (3) e rpcs_chamadas (3) preenchidos; só
--     estado_real = NULL. As demais subtelas /dashboard/projetos/obras/[id]/* estão 'parcial'.
--
-- Classifica como 'parcial' (mesmo patamar das irmãs; a tela entrega a jornada de requisição mas o
-- blueprint da obra ainda tem itens pendentes). Valor permitido pelo domínio usado nas irmãs.
--
-- ADITIVA e metadado apenas (system_screens é catálogo interno de telas, não é dado de cliente):
-- não toca RLS, policy, grant, comportamento nem dado de cliente. IDEMPOTENTE: só age enquanto
-- estado_real IS NULL; reaplicar não altera nada.
UPDATE public.system_screens
   SET estado_real = 'parcial',
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/obras/[id]/materiais'
   AND estado_real IS NULL;
