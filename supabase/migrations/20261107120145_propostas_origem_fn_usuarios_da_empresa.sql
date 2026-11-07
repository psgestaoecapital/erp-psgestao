-- /dashboard/projetos/propostas — completa a ORIGEM do dado (system_screens).
-- Code: desenvolvedor_4_g
--
-- Gap menor do PDCA auditor_pdca_1 (07/11): a tela de Propostas usa o RPC
-- fn_usuarios_da_empresa (src/app/dashboard/projetos/propostas/page.tsx:143) para
-- popular o <select> inline de atribuir orçamentista na linha (entregue em #4015),
-- mas a origem registrada em system_screens.rpcs_chamadas só listava fn_proposta_excluir.
-- RD-98 (pilar 3): a origem do dado tem de refletir todos os RPCs que a tela chama.
--
-- PROVA NO DADO (RD-38, produção, 07/11):
--   rota /dashboard/projetos/propostas →
--     rpcs_chamadas = {fn_proposta_excluir}
--     ('fn_usuarios_da_empresa' = ANY(...)) = false
--   public.fn_usuarios_da_empresa(p_company_id uuid) existe.
--
-- Esta migration só ACRESCENTA o RPC que faltava à lista de origem (coluna text[] de
-- metadado de tela — sem company_id, sem dado de cliente, sem RLS/policy/grant).
-- ADITIVA e IDEMPOTENTE: o guarda NOT (... = ANY(...)) zera o efeito no 2º run.

UPDATE public.system_screens
   SET rpcs_chamadas = rpcs_chamadas || ARRAY['fn_usuarios_da_empresa']
 WHERE rota = '/dashboard/projetos/propostas'
   AND NOT ('fn_usuarios_da_empresa' = ANY(rpcs_chamadas));
