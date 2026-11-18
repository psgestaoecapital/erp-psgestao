-- RD-98 p3 (origem do dado) — classificar estado_real e registrar a origem do dado
-- (views/tabelas lidas) de 3 telas autocontidas que estavam 'desconhecida' com 0 fontes.
--
-- Fontes PROVADAS no código (RD-38, leitura de src/app/dashboard/<rota>/page.tsx):
--   /dashboard/ficha-tecnica          → supabase.from: users, company_groups, companies, user_companies,
--                                        fichas_tecnicas, ficha_itens
--   /dashboard/assessor/diagnosticos  → supabase.from: clientes_assessoria, companies, omie_imports
--   /dashboard/assessor/dashboard-ceo → supabase.from: users, companies, user_companies, omie_imports
--
-- Todo o acesso a dados está no próprio page.tsx. Nenhuma chama RPC.
-- estado_real='parcial' (funcional no código, sem verificação ponta a ponta / "?" RD-95 ainda incompleto).
--
-- Apenas METADADO de system_screens. Não toca RLS, dado de cliente nem comportamento.
-- ADITIVA e IDEMPOTENTE: só classifica quando ainda 'desconhecida' e só preenche a origem quando ainda vazia.

-- /dashboard/ficha-tecnica
UPDATE public.system_screens
SET estado_real = 'parcial'
WHERE rota = '/dashboard/ficha-tecnica' AND estado_real = 'desconhecida';

UPDATE public.system_screens
SET views_consumidas = ARRAY['users','company_groups','companies','user_companies','fichas_tecnicas','ficha_itens']::text[]
WHERE rota = '/dashboard/ficha-tecnica'
  AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);

-- /dashboard/assessor/diagnosticos
UPDATE public.system_screens
SET estado_real = 'parcial'
WHERE rota = '/dashboard/assessor/diagnosticos' AND estado_real = 'desconhecida';

UPDATE public.system_screens
SET views_consumidas = ARRAY['clientes_assessoria','companies','omie_imports']::text[]
WHERE rota = '/dashboard/assessor/diagnosticos'
  AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);

-- /dashboard/assessor/dashboard-ceo
UPDATE public.system_screens
SET estado_real = 'parcial'
WHERE rota = '/dashboard/assessor/dashboard-ceo' AND estado_real = 'desconhecida';

UPDATE public.system_screens
SET views_consumidas = ARRAY['users','companies','user_companies','omie_imports']::text[]
WHERE rota = '/dashboard/assessor/dashboard-ceo'
  AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);
