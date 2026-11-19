-- RD-98 p3 (origem do dado): registra a origem do dado das telas de CRM que estavam
-- com views_consumidas / rpcs_chamadas vazios em system_screens. Classificação de
-- metadados de desenvolvimento (tabela system_screens) — NÃO toca dado de cliente,
-- RLS, cálculo nem o estado_real. Aditivo e idempotente (set a valor fixo).
-- Fontes conferidas no dado (RD-38): fn_crm_quadro, fn_crm_oportunidade_ficha e a
-- tabela erp_contatos existem. Code: desenvolvedor_4_g

-- /dashboard/crm/pipeline (Funil de vendas): lê só a RPC fn_crm_quadro
UPDATE public.system_screens
SET rpcs_chamadas   = ARRAY['fn_crm_quadro']::text[],
    views_consumidas = COALESCE(NULLIF(views_consumidas, ARRAY[]::text[]), ARRAY[]::text[]),
    atualizado_em   = now()
WHERE rota = '/dashboard/crm/pipeline';

-- /dashboard/crm/oportunidade/[id] (Ficha do negócio): RPC fn_crm_oportunidade_ficha + tabela erp_contatos
UPDATE public.system_screens
SET rpcs_chamadas    = ARRAY['fn_crm_oportunidade_ficha']::text[],
    views_consumidas = ARRAY['erp_contatos']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/crm/oportunidade/[id]';
