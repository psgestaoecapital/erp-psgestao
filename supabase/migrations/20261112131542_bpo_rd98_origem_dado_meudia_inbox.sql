-- RD-98 pilar 3 (origem do dado): registrar views_consumidas / rpcs_chamadas
-- das telas BPO cuja metadata de origem estava incompleta/nula em system_screens.
--
-- Prova RD-38 (codigo VIVO @origin/main):
--   /dashboard/bpo/meu-dia  (src/app/dashboard/bpo/meu-dia/page.tsx)
--       carregar()  -> rpc("fn_bpo_meu_dia_v2", { p_user_id })   [load principal]
--       executarAcao() -> rpc("fn_bpo_inbox_acao", { ... })      [resolver/rejeitar/transferir/pular]
--       nao consome view direta (.from) -> views_consumidas = []
--   /dashboard/bpo/inbox    (src/app/dashboard/bpo/inbox/page.tsx)
--       loadCurrentUser() -> supabase.from('users')              [perfil do operador]
--       (rpcs ja registradas: fn_inbox_operador, fn_inbox_resolver, fn_ajuda_campo_listar)
--
-- Escopo: APENAS metadata de registro de tela (system_screens). Nao e dado de
-- cliente, nao altera RLS/grants, nao toca dado financeiro. Idempotente.

-- meu-dia: registrar as 2 RPCs e marcar views como [] (registrado, sem view direta)
UPDATE system_screens
SET rpcs_chamadas   = ARRAY['fn_bpo_meu_dia_v2','fn_bpo_inbox_acao']::text[],
    views_consumidas = COALESCE(views_consumidas, ARRAY[]::text[])
WHERE rota = '/dashboard/bpo/meu-dia';

-- inbox: a tela le a tabela users diretamente; incluir em views_consumidas
UPDATE system_screens
SET views_consumidas = (
      SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(views_consumidas, ARRAY[]::text[]) || ARRAY['users']::text[]))
    )
WHERE rota = '/dashboard/bpo/inbox'
  AND NOT ('users' = ANY(COALESCE(views_consumidas, ARRAY[]::text[])));
