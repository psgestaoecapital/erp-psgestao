-- /dashboard/projetos/obras/[id]/custos — completa a ORIGEM do dado (system_screens).
-- Code: desenvolvedor_4_g
--
-- Gap 3 (MENOR) do PDCA auditor_pdca_1 (06/11): a tela de Custos da obra usa o RPC
-- fn_obra_custo_editar (src/app/dashboard/projetos/obras/[id]/custos/page.tsx:92), mas a
-- origem registrada em system_screens.rpcs_chamadas só listava lancar/listar/excluir/existe.
--
-- PROVA NO DADO (RD-38, produção, 06/11):
--   rota /dashboard/projetos/obras/[id]/custos →
--     rpcs_chamadas = {fn_obra_custo_lancar, fn_obra_custo_listar, fn_obra_custo_excluir, fn_obra_existe}
--     (fn_obra_custo_editar = ANY(...)) = false
--   fn_obra_custo_editar(p_pagar_id uuid, p_dados jsonb) existe em public.
--
-- Esta migration só ACRESCENTA o RPC que faltava à lista de origem (coluna text[] de
-- metadado de tela — sem company_id, sem dado de cliente, sem RLS/policy/grant).
-- ADITIVA e IDEMPOTENTE: o guarda NOT (... = ANY(...)) zera o efeito no 2º run.

UPDATE public.system_screens
   SET rpcs_chamadas = rpcs_chamadas || ARRAY['fn_obra_custo_editar']
 WHERE rota = '/dashboard/projetos/obras/[id]/custos'
   AND NOT ('fn_obra_custo_editar' = ANY(rpcs_chamadas));
