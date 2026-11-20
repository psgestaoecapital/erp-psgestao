-- RD-98 p3 (origem do dado) — registra a origem do dado de /dashboard/bpo/automacao,
-- que estava com views_consumidas vazio em system_screens.
--
-- Apenas METADADO de system_screens (tabela de desenvolvimento). NÃO toca RLS, dado
-- de cliente, cálculo nem comportamento. ADITIVA e IDEMPOTENTE: só preenche quando vazio.
--
-- Fontes PROVADAS (RD-38, supabase.from em src/app/dashboard/bpo/automacao/page.tsx):
--   bpo_rotinas, bpo_sync_log, bpo_classificacoes, companies, company_groups,
--   omie_imports, user_companies, users
-- A tela não chama RPC pg (rpcs_chamadas permanece vazio).
-- Code: desenvolvedor_4_g

UPDATE public.system_screens
SET views_consumidas = ARRAY[
      'bpo_rotinas','bpo_sync_log','bpo_classificacoes','companies',
      'company_groups','omie_imports','user_companies','users'
    ]::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/bpo/automacao'
  AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);
