-- RD-98 p3 (origem do dado) — registra a origem do dado de /dashboard/bpo/foco,
-- que estava com views_consumidas e rpcs_chamadas vazios em system_screens.
--
-- Apenas METADADO de system_screens (tabela de desenvolvimento). NÃO toca RLS, dado
-- de cliente, cálculo nem o comportamento da tela. ADITIVA e IDEMPOTENTE: só
-- preenche quando ainda vazio.
--
-- Fontes PROVADAS no código (RD-38) e nas definições vivas das RPCs (pg_get_functiondef):
--   src/app/dashboard/bpo/foco/page.tsx            → rpc fn_bpo_listar_empresas_foco
--   src/app/dashboard/bpo/foco/[company_id]/page.tsx → rpc fn_bpo_modo_foco_empresa
--   As RPCs leem: bpo_inbox_items, bpo_classificacoes, conciliacao_lote,
--                 bpo_companies_assignment, bpo_contratos, companies
-- Existência das tabelas conferida no banco. estado_real permanece 'parcial'.
-- Code: desenvolvedor_4_g

UPDATE public.system_screens
SET views_consumidas = ARRAY[
      'bpo_inbox_items','bpo_classificacoes','conciliacao_lote',
      'bpo_companies_assignment','bpo_contratos','companies'
    ]::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/bpo/foco'
  AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);

UPDATE public.system_screens
SET rpcs_chamadas = ARRAY[
      'fn_bpo_listar_empresas_foco','fn_bpo_modo_foco_empresa'
    ]::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/bpo/foco'
  AND (rpcs_chamadas IS NULL OR cardinality(rpcs_chamadas) = 0);
