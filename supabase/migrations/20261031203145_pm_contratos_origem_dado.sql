-- RD-98 p3 (ORIGEM DO DADO): preencher system_screens.views_consumidas/rpcs_chamadas da tela
-- /dashboard/pm/contratos. Aditivo: só metadado em system_screens. Idempotente (filtrado pela rota).
-- Listas do grep .from()/.rpc() de src/app/dashboard/pm/contratos/page.tsx.
UPDATE public.system_screens
SET views_consumidas = ARRAY['agency_briefings','agency_contratos','agency_jobs','agency_planejamentos','agency_servico','erp_contratos']::text[],
    rpcs_chamadas = ARRAY['fn_agency_contrato_item_excluir','fn_agency_contrato_item_salvar','fn_agency_contrato_listar','fn_agency_contrato_realizado','fn_agency_contrato_vincular_erp','fn_pm_planejamento_do_fee']::text[]
WHERE rota = '/dashboard/pm/contratos';
