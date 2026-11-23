-- PDCA · RD-98 p3 (origem do dado) · registra a origem da home /dashboard (roteador de áreas visíveis)
-- Code: desenvolvedor_4_g
--
-- Problema (RD-98 p3): a rota /dashboard está em system_screens como 'parcial' mas com rpcs_chamadas e
-- views_consumidas NULL — o aud8 não confere de onde a tela lê.
--
-- Fontes CONFERIDAS no código vivo (main), não supostas (RD-38):
--   src/app/dashboard/page.tsx (94 linhas, sem componentes de dados)
--     rpcs_chamadas:    fn_listar_areas_visiveis (l.56)
--     views_consumidas: user_companies (l.53)
-- A função (public) e a relação existem no banco (conferido em pg_proc/pg_class).
--
-- Aditivo e idempotente: só UPDATE em system_screens (metadado interno de auditoria). Não toca núcleo,
-- RLS, menu, função nem dado de cliente. Re-run grava o mesmo valor.
--
-- RD-38 (produção): ANTES rpcs e views NULL ; DEPOIS rpcs={fn_listar_areas_visiveis}, views={user_companies}.

UPDATE public.system_screens
SET rpcs_chamadas = ARRAY['fn_listar_areas_visiveis']::text[],
    views_consumidas = ARRAY['user_companies']::text[],
    atualizado_em = now()
WHERE rota = '/dashboard';
