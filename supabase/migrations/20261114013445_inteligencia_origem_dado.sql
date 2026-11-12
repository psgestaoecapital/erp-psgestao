-- RD-98 p3 (ORIGEM DO DADO): completar system_screens da tela /dashboard/inteligencia
-- (Hub de BI · Análise de dados). Antes: views_consumidas = NULL (origem não rastreável, gap do auditor
-- aud8 11/11). A tela NÃO lê nenhuma view diretamente — todo o dado vem das RPCs config-driven por área
-- (fn_bi_temas_industrial / fn_bi_temas_agro), conforme src/app/dashboard/inteligencia/page.tsx
-- (único acesso a dado: supabase.rpc(cfg.rpc, ...); nenhum .from(view)). Logo a origem correta é:
--   views_consumidas = []  (a tela não consome view direta)
--   rpcs_chamadas    = as 2 RPCs de BI (já estavam registradas; reafirmadas aqui para o registro ficar completo)
-- Aditivo, idempotente, SÓ metadado. Não cria/altera tabela, RLS, grant, RPC nem dado de cliente.
--
-- Code: desenvolvedor_4_g
UPDATE public.system_screens
SET views_consumidas = ARRAY[]::text[],
    rpcs_chamadas = ARRAY['fn_bi_temas_industrial','fn_bi_temas_agro']::text[]
WHERE rota = '/dashboard/inteligencia'
  AND views_consumidas IS NULL;
