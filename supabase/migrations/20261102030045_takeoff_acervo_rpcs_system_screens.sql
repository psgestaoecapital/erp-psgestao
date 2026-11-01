-- RD-98 pilar 3 (origem do dado): a tela /dashboard/projetos/takeoff/acervo
-- passou a chamar fn_takeoff_planta_excluir (acao Excluir planta, soft-delete
-- rastreavel adicionada na PR #3660) mas system_screens.rpcs_chamadas seguia
-- vazio para a rota. Documenta a origem do dado da tela conforme auditoria
-- auditor_pdca_1 (31/10, prova no dado): rpcs_chamadas estava [] e a tela
-- ja chama a RPC.
--
-- Aditivo/idempotente: apenas preenche a lista de RPCs quando ainda nao
-- contem a funcao. Nao mexe em dado de cliente, RLS, grants ou policy.
-- Prova (RD-38): SELECT rpcs_chamadas FROM system_screens
--   WHERE rota='/dashboard/projetos/takeoff/acervo'  ->  antes []
--   e o codigo em src/app/dashboard/projetos/takeoff/acervo/page.tsx chama
--   supabase.rpc('fn_takeoff_planta_excluir', ...) (unica RPC da tela).

UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY['fn_takeoff_planta_excluir']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/takeoff/acervo'
   AND NOT (rpcs_chamadas @> ARRAY['fn_takeoff_planta_excluir']::text[]);
