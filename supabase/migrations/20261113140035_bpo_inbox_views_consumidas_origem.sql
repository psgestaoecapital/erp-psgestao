-- PDCA bpo · /dashboard/bpo/inbox (aud8 86/95) — RD-98 p3 (origem do dado)
-- O system_screens da rota listava só a view "users" (1 view / 3 rpc), mas a tela
-- se alimenta também das fontes lidas pelas RPCs fn_inbox_operador/fn_inbox_resolver:
--   - bpo_inbox_items  (os itens do inbox: tarefas/alertas/classificações/cliente)
--   - companies        (o nome da empresa de cada item)
--   - users            (perfil do operador logado, lido direto na página)
-- Completa views_consumidas para refletir a origem real. Aditivo e idempotente;
-- não toca dado de cliente nem a tela. (RD-38: fontes extraídas do corpo das RPCs.)
-- Code: code-desenvolvedor-3
UPDATE public.system_screens
   SET views_consumidas = ARRAY['users','bpo_inbox_items','companies']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/bpo/inbox'
   AND views_consumidas IS DISTINCT FROM ARRAY['users','bpo_inbox_items','companies']::text[];
