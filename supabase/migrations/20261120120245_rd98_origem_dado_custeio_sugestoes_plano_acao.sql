-- RD-98 p3 (origem do dado) — classificar estado_real e registrar a origem do dado
-- (views/tabelas lidas + RPCs) de 3 telas autocontidas que estavam 'desconhecida' com 0 fontes.
--
-- Fontes PROVADAS no código (RD-38, leitura de src/app/dashboard/<rota>/page.tsx):
--   /dashboard/custeio             → supabase.from: users, companies, user_companies, cost_allocations, business_lines
--   /dashboard/sugestoes           → supabase.from: users, sugestoes
--   /dashboard/assessor/plano-acao → supabase.from: users, companies, user_companies, clientes_assessoria, plano_acao
--
-- Todo o acesso a dados está no próprio page.tsx (sem delegar a componente de fetch).
-- estado_real='parcial' (funcional no código, sem verificação ponta a ponta / "?" RD-95 ainda incompleto).
--
-- Apenas METADADO de system_screens. Não toca RLS, dado de cliente nem comportamento.
-- ADITIVA e IDEMPOTENTE: só classifica quando ainda 'desconhecida' e só preenche a origem
-- quando ainda vazia.

-- /dashboard/custeio
UPDATE public.system_screens
SET estado_real = 'parcial'
WHERE rota = '/dashboard/custeio' AND estado_real = 'desconhecida';

UPDATE public.system_screens
SET views_consumidas = ARRAY['users','companies','user_companies','cost_allocations','business_lines']::text[]
WHERE rota = '/dashboard/custeio'
  AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);

-- /dashboard/sugestoes
UPDATE public.system_screens
SET estado_real = 'parcial'
WHERE rota = '/dashboard/sugestoes' AND estado_real = 'desconhecida';

UPDATE public.system_screens
SET views_consumidas = ARRAY['users','sugestoes']::text[]
WHERE rota = '/dashboard/sugestoes'
  AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);

-- /dashboard/assessor/plano-acao
UPDATE public.system_screens
SET estado_real = 'parcial'
WHERE rota = '/dashboard/assessor/plano-acao' AND estado_real = 'desconhecida';

UPDATE public.system_screens
SET views_consumidas = ARRAY['users','companies','user_companies','clientes_assessoria','plano_acao']::text[]
WHERE rota = '/dashboard/assessor/plano-acao'
  AND (views_consumidas IS NULL OR cardinality(views_consumidas) = 0);
