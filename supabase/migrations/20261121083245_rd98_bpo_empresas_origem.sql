-- RD-98 p3 (origem do dado) — registra a origem do dado de /dashboard/bpo/empresas,
-- que estava com views_consumidas e rpcs_chamadas vazios em system_screens.
--
-- Apenas METADADO de system_screens (tabela de desenvolvimento). NÃO toca RLS, dado
-- de cliente, cálculo nem comportamento. ADITIVA e IDEMPOTENTE: só preenche quando vazio.
--
-- Fontes PROVADAS (RD-38):
--   src/app/dashboard/bpo/empresas/page.tsx → rpc fn_bpo_minhas_empresas
--   A RPC lê (pg_get_functiondef): bpo_companies_assignment, companies,
--                                  bpo_contratos, bpo_inbox_items
-- Code: desenvolvedor_4_g

UPDATE public.system_screens
SET views_consumidas = ARRAY[
      'bpo_companies_assignment','companies','bpo_contratos','bpo_inbox_items'
    ]::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/bpo/empresas'
  AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);

UPDATE public.system_screens
SET rpcs_chamadas = ARRAY['fn_bpo_minhas_empresas']::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/bpo/empresas'
  AND (rpcs_chamadas IS NULL OR cardinality(rpcs_chamadas) = 0);
