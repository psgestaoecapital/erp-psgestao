-- #2016 (#42): o CREATE OR REPLACE VIEW da matriz perdeu a opção security_invoker=on e a auditoria
-- (fn_seguranca_rls_auditar: view_com_direitos_do_dono = 1) ficou vermelha no @pos-migration.
-- Devolve o estado anterior. Só opção da view; nenhuma linha de dado muda.
ALTER VIEW public.v_compliance_matriz_funcionarios SET (security_invoker = on);
