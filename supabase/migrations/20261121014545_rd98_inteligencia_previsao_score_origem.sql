-- RD-98 p3 (origem do dado) — inteligência: registra a origem do dado
-- (views/tabelas lidas) de 2 telas que estavam com views_consumidas vazio em
-- system_screens.
--
-- Apenas METADADO de system_screens (tabela de desenvolvimento). NÃO toca RLS, dado
-- de cliente, cálculo nem o comportamento das telas. ADITIVA e IDEMPOTENTE: só
-- preenche quando ainda vazio — re-rodar não altera nada já preenchido.
--
-- Fontes PROVADAS no código (RD-38):
--   /dashboard/previsao → src/app/dashboard/previsao/page.tsx (supabase.from): users, companies,
--                         user_companies; rota /api/previsao-fluxo-ia (from): companies.
--   /dashboard/score    → src/app/dashboard/score/page.tsx (supabase.from): users, companies,
--                         user_companies, erp_clientes; rota /api/analise-cliente-ia (from):
--                         erp_clientes, erp_pedidos, v_lancamentos_consolidado.
-- Observação RD-38: o código também referencia `erp_score_historico`, que NÃO existe no
-- banco (nem tabela nem view) — portanto NÃO é registrado como fonte (caminho morto).
-- Existência das demais tabelas/views conferida no banco (information_schema/pg_class).
-- As rotas de IA chamam serviço externo/edge (sem RPC pg), por isso rpcs_chamadas fica vazio.
-- Code: desenvolvedor_4_g

-- /dashboard/previsao — Previsão de fluxo de caixa (IA)
UPDATE public.system_screens
SET views_consumidas = ARRAY['users','companies','user_companies']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/previsao'
  AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);

-- /dashboard/score — Score de clientes (análise de crédito/risco, IA)
UPDATE public.system_screens
SET views_consumidas = ARRAY['users','companies','user_companies','erp_clientes','erp_pedidos','v_lancamentos_consolidado']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/score'
  AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);
