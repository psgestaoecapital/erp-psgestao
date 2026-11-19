-- RD-98 p3 (origem do dado): classifica a tela /dashboard/crm/oportunidade/[id] (Ficha da
-- oportunidade), que estava com views_consumidas/rpcs_chamadas vazios em system_screens. Só
-- metadados de desenvolvimento (system_screens) — NÃO toca dado de cliente, RLS, segredo/vault,
-- cálculo nem estado_real; as RPCs apenas são REFERENCIADAS pelo nome, não alteradas. Aditivo e
-- idempotente (valor fixo). Fontes conferidas no dado (RD-38). Code: desenvolvedor_4_g
UPDATE public.system_screens
SET rpcs_chamadas = ARRAY['fn_crm_oportunidade_ficha','fn_crm_config']::text[],
    views_consumidas = ARRAY['erp_contatos']::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/crm/oportunidade/[id]';
