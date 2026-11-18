-- RD-98 p3 · origem do dado NULA em tres telas de MENU do CRM (menu ativo), enquanto as telas
-- irmas (ex.: /dashboard/crm/pipeline) ja tem o registro. So metadado de registro da tela.
--
-- Fontes reais das telas (prova no codigo, RD-38):
--   /dashboard/crm/contatos ("CRM · Contatos") -> src/app/dashboard/crm/contatos/page.tsx
--     * LEITURA: tabela erp_contatos  (.from, L36) — contatos da empresa.
--     * LEITURA: tabela erp_clientes  (.from, L38) — clientes (vinculo do contato a entidade).
--     * A tela opera direto nas tabelas (sem RPC) -> rpcs_chamadas = {} (documentado como "sem RPC").
--   /dashboard/crm/empresas ("CRM · Empresas") -> src/app/dashboard/crm/empresas/page.tsx
--     * LEITURA: tabela erp_clientes          (.from, L29) — empresas/clientes cadastrados.
--     * LEITURA: tabela erp_crm_oportunidade  (.from, L31) — oportunidades abertas por cliente.
--     * Sem RPC -> rpcs_chamadas = {}.
--   /dashboard/crm/leads ("CRM · Leads") -> src/app/dashboard/crm/leads/page.tsx
--     * LEITURA: tabela erp_crm_lead  (.from, L38) — leads da empresa.
--     * Sem RPC -> rpcs_chamadas = {}.
--
-- Estado antes (producao): as tres com views_consumidas = NULL e rpcs_chamadas = NULL.
--
-- Correcao corretiva e idempotente: NAO toca RLS, grants, dado de cliente, nem comportamento.
-- Prova BEGIN..ROLLBACK: 2x = mesmo resultado (UPDATE deterministico das linhas existentes por rota).

UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_contatos','erp_clientes']::text[],
       rpcs_chamadas    = ARRAY[]::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/crm/contatos';

UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_clientes','erp_crm_oportunidade']::text[],
       rpcs_chamadas    = ARRAY[]::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/crm/empresas';

UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_crm_lead']::text[],
       rpcs_chamadas    = ARRAY[]::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/crm/leads';
