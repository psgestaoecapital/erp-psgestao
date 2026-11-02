-- PDCA Hub · /dashboard/projetos/takeoff/acervo — origem do dado completa (RD-98 p3)
--
-- RECOMENDAÇÃO DO AUDITOR (matriz 01/11, score 96% "Pronta"): a tela já declara
--   erp_obra_planta e users em system_screens.views_consumidas e fn_takeoff_planta_excluir
--   em rpcs_chamadas. Faltava declarar a ORIGEM do download da planta: a page faz
--   supabase.storage.from('projetos-plantas').download(...) (page.tsx) — ou seja, o bucket
--   privado de storage 'projetos-plantas' é fonte de dado consumida pela tela e não constava.
--
-- ESTA MIGRATION (ADITIVA — só metadado de origem do dado; sem tabela/RLS/dado de cliente):
--   acrescenta 'projetos-plantas' (bucket de storage) à origem do dado da tela, preservando
--   as relações já declaradas. Idempotente (só acrescenta se faltar).

UPDATE public.system_screens
   SET views_consumidas = (
         SELECT ARRAY(
           SELECT DISTINCT v
           FROM unnest(
             COALESCE(views_consumidas, ARRAY[]::text[]) || ARRAY['erp_obra_planta','users','projetos-plantas']::text[]
           ) AS v
         )
       ),
       estado_real = 'pronto'
 WHERE rota = '/dashboard/projetos/takeoff/acervo';
