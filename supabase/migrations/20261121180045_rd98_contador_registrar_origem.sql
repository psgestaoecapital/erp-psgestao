-- RD-98 p3 (origem do dado): classifica a tela /dashboard/contador/registrar (Registrar
-- Escritório Contábil), que estava com views_consumidas/rpcs_chamadas vazios em system_screens.
-- Só metadados de desenvolvimento (system_screens) — NÃO toca dado de cliente, RLS,
-- segredo/vault, cálculo nem estado_real; as tabelas apenas são REFERENCIADAS pelo nome.
-- Aditivo e idempotente (valor fixo). Fontes conferidas no código (RD-38): a tela faz
-- POST em /api/contador/escritorio (route.ts), que grava via supabaseAdmin em
-- escritorios_contabeis, contadores e contador_api_keys; existência confirmada em pg_class.
-- Não há chamada de RPC.
-- Code: desenvolvedor_4_g
UPDATE public.system_screens
SET views_consumidas = ARRAY['escritorios_contabeis','contadores','contador_api_keys']::text[],
    rpcs_chamadas = ARRAY[]::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/contador/registrar';
