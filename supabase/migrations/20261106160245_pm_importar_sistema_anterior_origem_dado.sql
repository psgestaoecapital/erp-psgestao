-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas da tela
-- /dashboard/pm/importar-sistema-anterior ("P&M · Importar do sistema anterior").
-- GAP 2 da auditoria JORNADA auditor_pdca_2 (06/11): rpcs_chamadas já estava preenchido,
-- mas views_consumidas estava NULL.
-- A page.tsx consome SÓ via RPC (sem .from() direto); as fontes reais são as tabelas
-- lidas pelas RPCs, conferidas em pg_get_functiondef (RD-38):
--   fn_pm_importar_jobs_siga  -> agency_jobs, erp_clientes, agency_clientes,
--                                user_companies, users, agency_servico, erp_pm_siga_importacao
--   fn_pm_siga_importacoes_listar -> erp_pm_siga_importacao, users
-- Aditivo, idempotente, só metadado (sem tocar dado de cliente).
UPDATE public.system_screens
SET views_consumidas = ARRAY[
      'agency_jobs','erp_clientes','agency_clientes','user_companies','users',
      'agency_servico','erp_pm_siga_importacao'
    ]::text[]
WHERE rota = '/dashboard/pm/importar-sistema-anterior'
  AND views_consumidas IS NULL;
