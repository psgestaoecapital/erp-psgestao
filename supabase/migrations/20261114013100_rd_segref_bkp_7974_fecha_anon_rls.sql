-- conserto-main (gilberto-esteira) · Segurança PR B / auditoria RLS do briefing (fn_seguranca_rls_auditar)
-- A tabela de backup ORFA public.erp_banco_provider_config_bkp_7974 (copia de erp_banco_provider_config,
-- config de integracao bancaria por empresa) nasceu SEM RLS e com GRANT ao anon (regra: tabela nova nasce
-- com RLS e sem GRANT ao anon). A auditoria acusou sem_rls_com_company_id / tabela_sem_rls_com_anon /
-- anon_com_escrita_em_tabela_de_empresa, deixando o @pos-migration (seguranca-search-path-prb.spec.ts) vermelho
-- e o portao da main fechado. Esta migration FECHA o acesso sem tocar no dado (o backup fica preservado,
-- acessivel so por owner/service_role). Idempotente. Nao decide manter/apagar o backup — isso fica para o
-- Eng. Chefe/CEO (ver alerta do handoff).
ALTER TABLE IF EXISTS public.erp_banco_provider_config_bkp_7974 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_banco_provider_config_bkp_7974 FROM anon;
REVOKE ALL ON public.erp_banco_provider_config_bkp_7974 FROM authenticated;
