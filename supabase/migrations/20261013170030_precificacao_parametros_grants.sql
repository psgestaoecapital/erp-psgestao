-- GE · Precificação — higiene de privilégios da tabela de parâmetros (revisão Eng. Chefe 13/10 · rodrigo-code · faixa 30).
--
-- A tabela erp_precificacao_parametros nasceu na 20261013160030, mas o ALTER DEFAULT PRIVILEGES do Supabase concede
-- TODOS os privilégios a `authenticated` no momento do CREATE; a migration daquele PR só revogou de PUBLIC e anon, então
-- `authenticated` ficou com DELETE/TRUNCATE/REFERENCES/TRIGGER além de SELECT/INSERT/UPDATE. A escrita real passa pela
-- RPC fn_preco_config_empresa_salvar (SECURITY DEFINER, guarda de empresa); a RLS por empresa já limita as LINHAS. Aqui
-- tiramos os privilégios de tabela que `authenticated` não deve ter — fica só SELECT/INSERT/UPDATE.
--
-- Aditiva/higiene: só REVOKE/GRANT, sem tocar dados, estrutura, RLS nem função. Idempotente.
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.erp_precificacao_parametros FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.erp_precificacao_parametros TO authenticated;
-- anon continua sem nada (já revogado na 20261013160030); service_role mantém o acesso total de serviço.
REVOKE ALL ON TABLE public.erp_precificacao_parametros FROM PUBLIC, anon;
