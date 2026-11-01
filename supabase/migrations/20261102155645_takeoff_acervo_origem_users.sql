-- PDCA Hub · /dashboard/projetos/takeoff/acervo · aud8 70/95 · GAP único (RD-98 p3 origem do dado)
-- Code: desenvolvedor_4_g
--
-- A tela do Acervo de plantas lê, além de erp_obra_planta, a tabela public.users
-- (nome do autor da planta — page.tsx L159: supabase.from('users').select('id,full_name'))
-- e baixa do storage bucket 'projetos-plantas' (page.tsx L127). O system_screens só
-- registrava views_consumidas=['erp_obra_planta'], então a origem do dado (RD-98 p3)
-- estava incompleta.
--
-- CORREÇÃO: acrescentar 'users' em views_consumidas. O bucket de storage fica anotado
-- no cabeçalho da tela (page.tsx L12) e aqui, pois views_consumidas lista relações do
-- banco (tabelas/views), não buckets.
--
-- Aditiva: só UPDATE de metadado de tela (system_screens); não toca dado de cliente,
-- RLS, grants nem schema.

UPDATE system_screens
   SET views_consumidas = ARRAY['erp_obra_planta','users']::text[]
 WHERE rota = '/dashboard/projetos/takeoff/acervo';
