-- RD-98 p3 · origem do dado (auditor): as telas de dados do módulo Assessor estavam com
--   views_consumidas = NULL e rpcs_chamadas = NULL em system_screens. Isto registra a origem do
--   dado das rotas /dashboard/assessor/clientes e /dashboard/assessor/onboarding.
--
-- (A rota /dashboard/assessor é painel de navegação, sem origem de dado própria — não entra.)
--
-- Fontes reais das telas (prova no código, RD-38):
--   /dashboard/assessor/clientes -> src/app/dashboard/assessor/clientes/page.tsx
--       consome a API src/app/api/assessor/clientes/route.ts, que lê/grava:
--     * tabela assessorias          (.from('assessorias')         — assessoria do usuário + max_clientes)
--     * tabela clientes_assessoria  (.from('clientes_assessoria') — lista/contagem/CRUD dos clientes)
--     * tabela diagnosticos         (join diagnosticos(count)     — nº de diagnósticos por cliente)
--   /dashboard/assessor/onboarding -> src/app/dashboard/assessor/onboarding/page.tsx
--       consome a API src/app/api/assessor/onboarding/route.ts, que lê/grava:
--     * tabela assessorias          (.from('assessorias')         — cadastro/edição da assessoria)
--
-- As 3 tabelas foram conferidas existentes em produção (pg_tables). Nenhuma das duas telas chama RPC.
--
-- Correção corretiva e idempotente: só metadado de registro da tela (origem do dado). NÃO toca RLS,
-- grants, dado de cliente, nem comportamento. UPDATE determinístico das mesmas linhas existentes
-- (guardado por views_consumidas vazia), 2x = mesmo resultado.

UPDATE public.system_screens
   SET views_consumidas = ARRAY['assessorias','clientes_assessoria','diagnosticos']::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/assessor/clientes'
   AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);

UPDATE public.system_screens
   SET views_consumidas = ARRAY['assessorias']::text[],
       atualizado_em    = now()
 WHERE rota = '/dashboard/assessor/onboarding'
   AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);
